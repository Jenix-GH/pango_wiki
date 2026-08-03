package com.pango.controller;

import com.pango.rs.R;
import com.pango.service.ServiceAuth;
import com.pango.utils.MyAssert;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.Map;

@RestController
@RequestMapping("/auth")
public class ControllerAuth implements MyAssert {
    @Resource private ServiceAuth serviceAuth;

    @PostMapping("/sms/send")
    public R sendSms(@RequestBody Map<String, Object> params) {
        serviceAuth.sendCode(strIsNull(params.get("phone"), "手机号"), strIsNull(params.get("purpose"), "验证码用途"));
        return R.ok();
    }

    @PostMapping("/register")
    public R register(@RequestBody Map<String, Object> params) {
        return R.ok(serviceAuth.register(
                strIsNull(params.get("phone"), "手机号"),
                strIsNull(params.get("code"), "验证码"),
                strIsNull(params.get("password"), "密码"),
                optional(params.get("nickName")),
                optional(params.get("companyName")),
                optional(params.get("jobName")),
                optional(params.get("mailAddress"))));
    }

    @PostMapping("/login")
    public R login(@RequestBody Map<String, Object> params) {
        return R.ok(serviceAuth.login(strIsNull(params.get("phone"), "手机号"), strIsNull(params.get("password"), "密码")));
    }

    @PostMapping("/password/reset")
    public R resetPassword(@RequestBody Map<String, Object> params) {
        serviceAuth.resetPassword(
                strIsNull(params.get("phone"), "手机号"),
                strIsNull(params.get("code"), "验证码"),
                strIsNull(params.get("password"), "新密码"));
        return R.ok();
    }

    @GetMapping("/me")
    public R me(@RequestHeader(value = "Authorization", required = false) String authorization) {
        return R.ok(serviceAuth.getByToken(bearerToken(authorization)));
    }

    @PostMapping("/logout")
    public R logout(@RequestHeader(value = "Authorization", required = false) String authorization) {
        serviceAuth.logout(bearerToken(authorization));
        return R.ok();
    }

    private String bearerToken(String authorization) {
        if (authorization == null) return null;
        return authorization.startsWith("Bearer ") ? authorization.substring(7).trim() : authorization.trim();
    }

    private String optional(Object value) {
        if (value == null) return null;
        String result = String.valueOf(value).trim();
        return result.isEmpty() ? null : result;
    }
}
