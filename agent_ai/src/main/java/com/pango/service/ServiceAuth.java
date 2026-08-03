package com.pango.service;

import com.pango.entity.DtoQuestion;
import com.pango.entity.DtoUserinfo;
import com.pango.exception.MyException;
import lombok.AllArgsConstructor;
import lombok.Data;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Service
@Transactional
public class ServiceAuth {
    private static final String TOKEN_PREFIX = "auth:token:";
    private static final long TOKEN_DAYS = 30;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    @Resource private ServiceUserinfo serviceUserinfo;
    @Resource private ServiceQuestion serviceQuestion;
    @Resource private ServiceAnswer serviceAnswer;
    @Resource private ServiceSms serviceSms;
    @Resource private StringRedisTemplate stringRedisTemplate;

    public void sendCode(String phone, String purpose) {
        DtoUserinfo user = serviceUserinfo.getByPhone(phone);
        if ("REGISTER".equalsIgnoreCase(purpose) && user != null && hasPassword(user)) {
            throw new MyException("该手机号已注册，请直接登录");
        }
        if ("RESET_PASSWORD".equalsIgnoreCase(purpose) && user == null) {
            throw new MyException("该手机号尚未注册");
        }
        serviceSms.sendCode(phone, purpose);
    }

    public AuthResult register(String phone, String code, String password, String nickName,
                               String companyName, String jobName, String mailAddress) {
        validatePassword(password);
        validateProfile(companyName, jobName, mailAddress);
        DtoUserinfo user = serviceUserinfo.getByPhone(phone);
        if (user != null && hasPassword(user)) throw new MyException("该手机号已注册，请直接登录");
        serviceSms.verifyAndConsume(phone, "REGISTER", code);
        String hash = passwordEncoder.encode(password);
        if (user == null) {
            String name = nickName == null || nickName.trim().isEmpty() ? "用户" + phone.substring(7) : nickName.trim();
            user = serviceUserinfo.createPhoneUser(phone, name, hash);
        } else {
            user.setPhoneNumber(phone).setPasswordHash(hash);
            if (user.getWxCode() == null || user.getWxCode().trim().isEmpty()) user.setWxCode(phone);
            if (nickName != null && !nickName.trim().isEmpty()) user.setNickName(nickName.trim());
            serviceUserinfo.updateById(user);
        }
        if (companyName != null) user.setCompanyName(companyName);
        if (jobName != null) user.setJobName(jobName);
        if (mailAddress != null) user.setMailAddress(mailAddress);
        serviceUserinfo.updateById(user);
        return createSession(enrich(user));
    }

    public AuthResult login(String phone, String password) {
        serviceSms.validatePhone(phone);
        DtoUserinfo user = serviceUserinfo.getByPhone(phone);
        if (user == null || !hasPassword(user) || !passwordEncoder.matches(password == null ? "" : password, user.getPasswordHash())) {
            throw new MyException("手机号或密码错误");
        }
        return createSession(enrich(user));
    }

    public void resetPassword(String phone, String code, String password) {
        validatePassword(password);
        DtoUserinfo user = serviceUserinfo.getByPhone(phone);
        if (user == null) throw new MyException("该手机号尚未注册");
        serviceSms.verifyAndConsume(phone, "RESET_PASSWORD", code);
        user.setPhoneNumber(phone).setPasswordHash(passwordEncoder.encode(password));
        serviceUserinfo.updateById(user);
        revokeUserTokens(user.getId());
    }

    public DtoUserinfo getByToken(String token) {
        if (token == null || token.trim().isEmpty()) throw new MyException("登录状态已失效，请重新登录");
        String userId = stringRedisTemplate.opsForValue().get(TOKEN_PREFIX + token);
        if (userId == null) throw new MyException("登录状态已失效，请重新登录");
        stringRedisTemplate.expire(TOKEN_PREFIX + token, TOKEN_DAYS, TimeUnit.DAYS);
        return enrich(serviceUserinfo.getByUserId(Integer.parseInt(userId)));
    }

    public void logout(String token) {
        if (token == null || token.trim().isEmpty()) return;
        String userId = stringRedisTemplate.opsForValue().get(TOKEN_PREFIX + token);
        stringRedisTemplate.delete(TOKEN_PREFIX + token);
        if (userId != null) stringRedisTemplate.opsForSet().remove(userTokensKey(Long.parseLong(userId)), token);
    }

    private AuthResult createSession(DtoUserinfo user) {
        String token = UUID.randomUUID().toString().replace("-", "");
        stringRedisTemplate.opsForValue().set(TOKEN_PREFIX + token, String.valueOf(user.getId()), TOKEN_DAYS, TimeUnit.DAYS);
        stringRedisTemplate.opsForSet().add(userTokensKey(user.getId()), token);
        stringRedisTemplate.expire(userTokensKey(user.getId()), TOKEN_DAYS, TimeUnit.DAYS);
        return new AuthResult(token, user);
    }

    private DtoUserinfo enrich(DtoUserinfo user) {
        int userId = Math.toIntExact(user.getId());
        DtoQuestion question = serviceQuestion.findHisByUserId(userId);
        if (question != null) user.setTodayQuestionList(question.getTodayQuestion()).setWeekQuestionList(question.getWeekQuestion());
        user.setCount(serviceAnswer.getCount(userId));
        user.setFlagCompanyInfo(serviceUserinfo.getCompany(userId) != 0);
        return user;
    }

    private boolean hasPassword(DtoUserinfo user) {
        return user.getPasswordHash() != null && !user.getPasswordHash().trim().isEmpty();
    }

    private void validatePassword(String password) {
        if (password == null || password.length() < 8 || password.length() > 64) {
            throw new MyException("密码长度必须为8至64位");
        }
    }

    private void validateProfile(String companyName, String jobName, String mailAddress) {
        if (companyName != null && companyName.length() > 200) throw new MyException("公司名称长度不能超过200位");
        if (jobName != null && jobName.length() > 100) throw new MyException("职位长度不能超过100位");
        if (mailAddress != null) {
            if (mailAddress.length() > 200 || !mailAddress.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
                throw new MyException("请输入正确的邮箱地址");
            }
        }
    }

    private void revokeUserTokens(Long userId) {
        String key = userTokensKey(userId);
        java.util.Set<String> tokens = stringRedisTemplate.opsForSet().members(key);
        if (tokens != null && !tokens.isEmpty()) {
            String[] keys = tokens.stream().map(token -> TOKEN_PREFIX + token).toArray(String[]::new);
            stringRedisTemplate.delete(java.util.Arrays.asList(keys));
        }
        stringRedisTemplate.delete(key);
    }

    private String userTokensKey(Long userId) {
        return "auth:user_tokens:" + userId;
    }

    @Data
    @AllArgsConstructor
    public static class AuthResult {
        private String token;
        private DtoUserinfo user;
    }
}
