package com.pango.controller;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
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
    private static final long MAX_FEEDBACK_IMAGE_BYTES = 15L * 1024 * 1024;
    private static final int MAX_FEEDBACK_IMAGE_JSON_CHARS = 22 * 1024 * 1024;

    @Resource
    private ServiceFeedback serviceFeedback;

    @PostMapping("/submit")
    public R submit(@RequestBody DtoFeedback feedback) {
        feedback.setPlatform(required(feedback.getPlatform(), "反馈平台", 20));
        feedback.setFeedbackType(required(feedback.getFeedbackType(), "反馈类型", 30));
        feedback.setQuestionContent(required(feedback.getQuestionContent(), "用户问题", 4000));
        feedback.setAnswerContent(required(feedback.getAnswerContent(), "AI回答", 20000));
        feedback.setFeedbackImages(validateFeedbackImages(feedback.getFeedbackImages()));
        feedback.setSessionId(optional(feedback.getSessionId(), 100));
        feedback.setDetail(optional(feedback.getDetail(), 2000));
        feedback.setContactName(optional(feedback.getContactName(), 100));
        feedback.setCompanyName(optional(feedback.getCompanyName(), 200));
        feedback.setEmail(optional(feedback.getEmail(), 200));
        feedback.setPhone(optional(feedback.getPhone(), 50));
        return R.ok(serviceFeedback.submit(feedback));
    }

    private String validateFeedbackImages(String value) {
        if (!StringUtils.hasText(value)) return null;
        if (value.length() > MAX_FEEDBACK_IMAGE_JSON_CHARS) throw new MyException("反馈图片数据过大");
        try {
            JSONArray images = JSONArray.parseArray(value);
            if (images.size() > 1) throw new MyException("问题反馈最多只能上传1张图片");
            if (images.isEmpty()) return null;
            JSONObject image = images.getJSONObject(0);
            if (image == null) throw new MyException("反馈图片数据格式错误");
            String mimeType = image.getString("mime_type");
            String dataBase64 = image.getString("data_base64");
            if (mimeType == null || !mimeType.toLowerCase().matches("image/(jpeg|png|webp)")
                    || !StringUtils.hasText(dataBase64)) {
                throw new MyException("反馈图片仅支持 JPEG、PNG 或 WebP");
            }
            String filename = image.getString("filename");
            if (filename != null && filename.length() > 255) throw new MyException("反馈图片文件名过长");
            if (decodedBase64Size(dataBase64) > MAX_FEEDBACK_IMAGE_BYTES) {
                throw new MyException("反馈图片大小不能超过15MB");
            }
            return images.toJSONString();
        } catch (MyException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new MyException("反馈图片数据格式错误");
        }
    }

    private long decodedBase64Size(String value) {
        int length = value.length();
        if (length == 0 || length % 4 != 0) throw new MyException("反馈图片Base64格式错误");
        int padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
        int contentLength = length - padding;
        for (int index = 0; index < contentLength; index++) {
            char current = value.charAt(index);
            boolean valid = current >= 'A' && current <= 'Z'
                    || current >= 'a' && current <= 'z'
                    || current >= '0' && current <= '9'
                    || current == '+' || current == '/';
            if (!valid) throw new MyException("反馈图片Base64格式错误");
        }
        for (int index = contentLength; index < length; index++) {
            if (value.charAt(index) != '=') throw new MyException("反馈图片Base64格式错误");
        }
        return (long) length / 4 * 3 - padding;
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
