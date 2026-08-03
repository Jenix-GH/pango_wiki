package com.pango.controller;

import com.pango.entity.DtoLicenseApplication;
import com.pango.exception.MyException;
import com.pango.rs.R;
import com.pango.service.ServiceLicenseApplication;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.annotation.Resource;
import java.util.Arrays;

@RestController
@RequestMapping("/license/application")
public class ControllerLicenseApplication {
    @Resource
    private ServiceLicenseApplication serviceLicenseApplication;

    @PostMapping("/submit")
    public R submit(@RequestBody DtoLicenseApplication application) {
        application.setOperatingSystem(option(application.getOperatingSystem(), "操作系统版本", "Windows", "Linux"));
        application.setSoftwareVersion(required(application.getSoftwareVersion(), "软件版本", 50));
        application.setLicenseType(option(application.getLicenseType(), "授权类型", "STANDALONE", "SERVER"));
        if (application.getDurationYears() == null || !Arrays.asList(1, 2, 3).contains(application.getDurationYears())) {
            throw new MyException("使用时长只能选择1年、2年或3年");
        }
        String macAddress = required(application.getMacAddress(), "MAC地址", 17).toUpperCase();
        if (!macAddress.matches("^[0-9A-F]{2}(?:-[0-9A-F]{2}){5}$")) {
            throw new MyException("MAC地址格式不正确，请使用-分隔");
        }
        application.setMacAddress(macAddress);
        application.setApplicantName(required(application.getApplicantName(), "申请人", 100));
        application.setCompanyName(required(application.getCompanyName(), "公司", 200));
        String email = required(application.getEmail(), "邮箱", 200);
        if (!email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) throw new MyException("邮箱格式不正确");
        application.setEmail(email);
        application.setPhone(required(application.getPhone(), "电话", 50));
        application.setAddress(required(application.getAddress(), "地址", 500));
        return R.ok(serviceLicenseApplication.submit(application));
    }

    private String option(String value, String label, String... options) {
        String result = required(value, label, 30);
        if (!Arrays.asList(options).contains(result)) throw new MyException(label + "选项不正确");
        return result;
    }

    private String required(String value, String label, int maxLength) {
        if (!StringUtils.hasText(value)) throw new MyException(label + "不能为空");
        String result = value.trim();
        if (result.length() > maxLength) throw new MyException(label + "长度超过限制");
        return result;
    }
}
