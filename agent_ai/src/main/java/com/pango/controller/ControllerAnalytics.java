package com.pango.controller;

import com.pango.entity.DtoUserinfo;
import com.pango.exception.MyException;
import com.pango.rs.R;
import com.pango.service.ServiceAnalytics;
import com.pango.service.ServiceAuth;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/analytics")
public class ControllerAnalytics {
    private static final Set<String> EVENTS = new HashSet<>(Arrays.asList(
            "page_view", "chat_success", "chat_failed", "wiki_view", "document_read",
            "document_download", "reference_open", "answer_image_view", "user_guide_view",
            "miniprogram_qrcode_view"));
    private static final Set<String> CLIENT_TYPES = new HashSet<>(Arrays.asList("WEB", "MINIPROGRAM"));

    @Resource private ServiceAnalytics serviceAnalytics;
    @Resource private ServiceAuth serviceAuth;

    @PostMapping("/track")
    public R track(@RequestBody Map<String, Object> params,
                   @RequestHeader(value = "Authorization", required = false) String authorization,
                   HttpServletRequest request) {
        DtoUserinfo user = serviceAuth.resolveUser(authorization);
        String eventName = required(params.get("eventName"), "事件名称", 64).toLowerCase();
        String clientType = required(params.get("clientType"), "客户端类型", 20).toUpperCase();
        if (!EVENTS.contains(eventName)) throw new MyException("不支持的统计事件");
        if (!CLIENT_TYPES.contains(clientType)) throw new MyException("不支持的客户端类型");
        serviceAnalytics.record(eventName, optional(params.get("pagePath"), 255), clientType, user.getId(),
                optional(params.get("sessionId"), 100), optional(params.get("documentId"), 100),
                clientIp(request), optional(request.getHeader("User-Agent"), 500));
        return R.ok();
    }

    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        String value = StringUtils.hasText(forwarded) ? forwarded.split(",")[0].trim() : request.getRemoteAddr();
        return value.length() > 64 ? value.substring(0, 64) : value;
    }

    private String required(Object value, String label, int maxLength) {
        String result = optional(value, maxLength);
        if (!StringUtils.hasText(result)) throw new MyException(label + "不能为空");
        return result;
    }

    private String optional(Object value, int maxLength) {
        if (value == null) return null;
        String result = String.valueOf(value).trim();
        if (result.length() > maxLength) throw new MyException("统计字段长度超过限制");
        return result.isEmpty() ? null : result;
    }
}
