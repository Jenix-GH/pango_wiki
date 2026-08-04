package com.pango.controller;

import com.pango.entity.DtoQuestion;
import com.pango.entity.DtoUserinfo;
import com.pango.rs.R;
import com.pango.service.*;
import com.pango.utils.MyAssert;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import javax.annotation.Resource;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/wx")
@Slf4j
public class ControllerWx implements MyAssert {

    @Resource
    private ServiceWx serviceWx;
    @Resource
    private ServiceUserinfo serviceUserinfo;
    @Resource
    private ServiceAnswer serviceAnswer;
    @Resource
    private ServiceAuth serviceAuth;

    /**
     * 获取手机号
     *
     * @return R
     */
    @PostMapping("/getPhone")
    public R getPhoneByCode(@RequestBody Map<String, Object> params) {
        String code = strIsNull(params.get("code"), "Code");
        String nickName = strIsNull(params.get("nickName"), "昵称");
        String phone = serviceWx.decryptPhone(code);
        if (phone == null || phone.isEmpty()) {
            return R.error("获取手机号失败", "请稍后再试");
        }
        // 新增用户信息
        DtoUserinfo userinfo = serviceUserinfo.doAdd(phone, nickName);
        int userId = Math.toIntExact(userinfo.getId());
        //注入该用户的历史问题记录
        DtoQuestion question = serviceQuestion.findHisByUserId(userId);
        if(null != question){
            userinfo.setTodayQuestionList(question.getTodayQuestion())
                    .setWeekQuestionList(question.getWeekQuestion());
        }
        userinfo.setCount(serviceAnswer.getCount(userId));
        int flagCompany = serviceUserinfo.getCompany(userId);
        userinfo.setFlagCompanyInfo(flagCompany != 0); //返回用户是否有填写公司信息
        userinfo.setAccessToken(serviceAuth.createSession(userinfo).getToken());
        return R.ok(userinfo);
    }

    @GetMapping("/test/{code}")
    public R getTest(String code) {
        log.info("get_test >>>>>>" + code);
        return R.ok(code);
    }

    @PostMapping("/test1")
    public R postTest(@RequestBody Map<String, Object> params) {
        Object tmp = params.get("code");
        log.info("post_test >>>>>>" + tmp);
        return R.ok(tmp);
    }

    @Resource
    private ServiceWxAudio serviceWxAudio;
    @Resource
    private ServiceQuestion serviceQuestion;

    @PostMapping("/transcribe")
    public R transcribeAudio(@RequestParam("audio") MultipartFile audioFile) {
        try {
            // 验证文件格式
            if (audioFile.isEmpty()) {
                return R.error("文件无效", "请上传有效的音频文件");
            }
            //处理数据
            String text = serviceWxAudio.getTextByAudio(audioFile);
            Map<String, String> rs = new HashMap<>();
            rs.put("text", text);
            return R.ok(rs);
        } catch (Exception e) {
            return R.error("处理失败", e.getMessage());
        }
    }

}
