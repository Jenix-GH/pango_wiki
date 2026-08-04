package com.pango.controller;

import com.pango.exception.MyException;
import com.pango.rs.R;
import com.pango.service.ServiceAdminConsole;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

@RestController
@RequestMapping("/admin/console")
public class ControllerAdminConsole {
    @Value("${admin.console-key:}")
    private String configuredKey;
    @Resource private ServiceAdminConsole serviceAdminConsole;

    @GetMapping("/dashboard")
    public R dashboard(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                       @RequestParam(defaultValue = "30") int days) {
        authorize(key);
        return R.ok(serviceAdminConsole.dashboard(Math.max(1, Math.min(days, 365))));
    }

    @GetMapping("/events")
    public R events(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                    @RequestParam(defaultValue = "1") int page,
                    @RequestParam(defaultValue = "50") int pageSize,
                    @RequestParam(required = false) String eventName,
                    @RequestParam(required = false) String clientType) {
        authorize(key);
        return R.ok(serviceAdminConsole.events(validPage(page), validPageSize(pageSize), eventName, clientType));
    }

    @GetMapping("/feedback")
    public R feedback(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                      @RequestParam(defaultValue = "1") int page,
                      @RequestParam(defaultValue = "30") int pageSize,
                      @RequestParam(required = false) Integer status) {
        authorize(key);
        validateStatus(status, 3);
        return R.ok(serviceAdminConsole.feedback(validPage(page), validPageSize(pageSize), status));
    }

    @PostMapping("/feedback/{id}/status")
    public R updateFeedback(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                            @PathVariable long id, @RequestBody Map<String, Object> body) {
        authorize(key);
        int status = integer(body.get("status"));
        validateStatus(status, 3);
        serviceAdminConsole.updateFeedbackStatus(id, status);
        return R.ok();
    }

    @GetMapping("/licenses")
    public R licenses(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                      @RequestParam(defaultValue = "1") int page,
                      @RequestParam(defaultValue = "30") int pageSize,
                      @RequestParam(required = false) Integer status) {
        authorize(key);
        validateStatus(status, 3);
        return R.ok(serviceAdminConsole.licenses(validPage(page), validPageSize(pageSize), status));
    }

    @PostMapping("/licenses/{id}/status")
    public R updateLicense(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                           @PathVariable long id, @RequestBody Map<String, Object> body) {
        authorize(key);
        int status = integer(body.get("status"));
        validateStatus(status, 3);
        serviceAdminConsole.updateLicenseStatus(id, status);
        return R.ok();
    }

    private void authorize(String key) {
        if (configuredKey == null || configuredKey.length() < 16) throw new MyException("管理控制台未配置");
        byte[] expected = configuredKey.getBytes(StandardCharsets.UTF_8);
        byte[] actual = (key == null ? "" : key).getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, actual)) throw new MyException("管理密钥无效");
    }

    private int validPage(int page) { return Math.max(1, page); }
    private int validPageSize(int pageSize) { return Math.max(1, Math.min(pageSize, 100)); }
    private int integer(Object value) {
        try { return Integer.parseInt(String.valueOf(value)); }
        catch (Exception error) { throw new MyException("状态参数不正确"); }
    }
    private void validateStatus(Integer status, int max) {
        if (status != null && (status < 0 || status > max)) throw new MyException("状态参数不正确");
    }
}
