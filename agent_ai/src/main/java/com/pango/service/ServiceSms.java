package com.pango.service;

import com.alibaba.fastjson.JSONObject;
import com.aliyun.dysmsapi20170525.Client;
import com.aliyun.dysmsapi20170525.models.SendSmsRequest;
import com.aliyun.dysmsapi20170525.models.SendSmsResponse;
import com.aliyun.teaopenapi.models.Config;
import com.pango.exception.MyException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

@Service
public class ServiceSms {
    private static final Pattern PHONE_PATTERN = Pattern.compile("^1[3-9]\\d{9}$");
    private static final SecureRandom RANDOM = new SecureRandom();

    @Value("${ali_sms.access-key-id}") private String accessKeyId;
    @Value("${ali_sms.access-key-secret}") private String accessKeySecret;
    @Value("${ali_sms.endpoint:dysmsapi.aliyuncs.com}") private String endpoint;
    @Value("${ali_sms.sign-name}") private String signName;
    @Value("${ali_sms.template-code}") private String templateCode;
    @Value("${ali_sms.code-expire-minutes:5}") private long expireMinutes;
    @Value("${ali_sms.send-interval-seconds:60}") private long sendIntervalSeconds;

    @Resource private StringRedisTemplate stringRedisTemplate;
    private volatile Client client;

    public void sendCode(String phone, String purpose) {
        validatePhone(phone);
        String normalizedPurpose = normalizePurpose(purpose);
        String rateKey = "auth:sms:rate:" + normalizedPurpose + ":" + phone;
        Boolean allowed = stringRedisTemplate.opsForValue().setIfAbsent(rateKey, "1", sendIntervalSeconds, TimeUnit.SECONDS);
        if (!Boolean.TRUE.equals(allowed)) throw new MyException("验证码发送过于频繁，请稍后再试");

        String code = String.format("%06d", RANDOM.nextInt(1000000));
        try {
            SendSmsRequest request = new SendSmsRequest()
                    .setSignName(signName)
                    .setTemplateCode(templateCode)
                    .setPhoneNumbers(phone)
                    .setTemplateParam(JSONObject.toJSONString(Collections.singletonMap("code", code)));
            SendSmsResponse response = getClient().sendSms(request);
            String resultCode = response.getBody() == null ? null : response.getBody().getCode();
            if (!"OK".equalsIgnoreCase(resultCode)) {
                String message = response.getBody() == null ? "短信服务未返回结果" : response.getBody().getMessage();
                throw new MyException("短信发送失败：" + message);
            }
            stringRedisTemplate.opsForValue().set(codeKey(normalizedPurpose, phone), code, expireMinutes, TimeUnit.MINUTES);
        } catch (MyException e) {
            stringRedisTemplate.delete(rateKey);
            throw e;
        } catch (Exception e) {
            stringRedisTemplate.delete(rateKey);
            throw new MyException("短信发送失败，请稍后重试");
        }
    }

    public void verifyAndConsume(String phone, String purpose, String code) {
        validatePhone(phone);
        if (code == null || !code.matches("^\\d{6}$")) throw new MyException("请输入6位短信验证码");
        String normalizedPurpose = normalizePurpose(purpose);
        String key = codeKey(normalizedPurpose, phone);
        String failKey = "auth:sms:verify_fail:" + normalizedPurpose + ":" + phone;
        String saved = stringRedisTemplate.opsForValue().get(key);
        if (saved == null) throw new MyException("验证码已过期，请重新获取");
        if (!saved.equals(code)) {
            Long failures = stringRedisTemplate.opsForValue().increment(failKey);
            if (failures != null && failures == 1) stringRedisTemplate.expire(failKey, expireMinutes, TimeUnit.MINUTES);
            if (failures != null && failures >= 5) {
                stringRedisTemplate.delete(key);
                stringRedisTemplate.delete(failKey);
                throw new MyException("验证码错误次数过多，请重新获取");
            }
            throw new MyException("验证码错误");
        }
        stringRedisTemplate.delete(key);
        stringRedisTemplate.delete(failKey);
    }

    public void validatePhone(String phone) {
        if (phone == null || !PHONE_PATTERN.matcher(phone.trim()).matches()) throw new MyException("请输入正确的中国大陆手机号");
    }

    private String normalizePurpose(String purpose) {
        String normalized = purpose == null ? "" : purpose.trim().toUpperCase(Locale.ROOT);
        if (!"REGISTER".equals(normalized) && !"RESET_PASSWORD".equals(normalized)) throw new MyException("不支持的验证码用途");
        return normalized;
    }

    private String codeKey(String purpose, String phone) {
        return "auth:sms:code:" + purpose + ":" + phone;
    }

    private Client getClient() throws Exception {
        if (client == null) {
            synchronized (this) {
                if (client == null) {
                    Config config = new Config().setAccessKeyId(accessKeyId).setAccessKeySecret(accessKeySecret);
                    config.endpoint = endpoint;
                    client = new Client(config);
                }
            }
        }
        return client;
    }
}
