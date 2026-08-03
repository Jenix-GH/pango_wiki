package com.pango.controller;

import com.pango.entity.DtoFeedback;
import com.pango.exception.MyException;
import com.pango.rs.R;
import com.pango.service.ServiceFeedback;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.annotation.Resource;

@RestController
@RequestMapping("/feedback")
public class ControllerFeedback {

    @Resource
    private ServiceFeedback serviceFeedback;

    @PostMapping("/submit")
    public R submit(@RequestBody DtoFeedback feedback) {
        feedback.setPlatform(required(feedback.getPlatform(), "反馈平台", 20));
        feedback.setFeedbackType(required(feedback.getFeedbackType(), "反馈类型", 30));
        feedback.setQuestionContent(required(feedback.getQuestionContent(), "用户问题", 4000));
        feedback.setAnswerContent(required(feedback.getAnswerContent(), "AI回答", 20000));
        feedback.setSessionId(optional(feedback.getSessionId(), 100));
        feedback.setDetail(optional(feedback.getDetail(), 2000));
        feedback.setContactName(optional(feedback.getContactName(), 100));
        feedback.setCompanyName(optional(feedback.getCompanyName(), 200));
        feedback.setEmail(optional(feedback.getEmail(), 200));
        feedback.setPhone(optional(feedback.getPhone(), 50));
        return R.ok(serviceFeedback.submit(feedback));
    }

    private String required(String value, String label, int maxLength) {
        String result = optional(value, maxLength);
        if (!StringUtils.hasText(result)) {
            throw new MyException(label + "不能为空");
        }
        return result;
    }

    private String optional(String value, int maxLength) {
        if (value == null) return null;
        String result = value.trim();
        if (result.length() > maxLength) {
            throw new MyException("提交内容长度超过限制");
        }
        return result.isEmpty() ? null : result;
    }
}
