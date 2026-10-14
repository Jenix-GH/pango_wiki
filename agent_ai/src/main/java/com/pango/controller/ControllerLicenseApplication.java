package com.pango.controller;

import com.pango.entity.DtoLicenseApplication;
import com.pango.exception.MyException;
import com.pango.rs.R;
import com.pango.service.ServiceLicenseApplication;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import com.pango.service.ServiceLicensePortal;
import org.springframework.http.ResponseEntity;
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

    @Resource private ServiceLicensePortal portal;

    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    public ResponseEntity<R> handleLicenseHttpException(org.springframework.web.server.ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatus()).body(
                R.error(exception.getRawStatusCode(), exception.getReason(), null));
    }

    @GetMapping("/mine")
    public ResponseEntity<R> mine(@RequestHeader(value = "Authorization", required = false) String authorization,
                  @RequestParam(defaultValue = "1") int page) {
        return ResponseEntity.ok().header("Cache-Control", "no-store, private").body(R.ok(portal.list(portal.requireMember(authorization), page)));
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> download(@RequestHeader(value = "Authorization", required = false) String authorization,
                                            @PathVariable long id) {
        return portal.download(portal.requireMember(authorization), id);
    }

    @PostMapping("/submit")
    public R submit(@RequestHeader(value = "Authorization", required = false) String authorization,
                    @RequestBody DtoLicenseApplication application) {
        application.setUserinfoId(portal.requireMember(authorization)).setOwnerVerified(true);
        if (application.getOfficialSubmitted() == null) throw new MyException("请选择是否已在官网提交");
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
        application.setCompanyName(required(application.getCompanyName(), "公司或学校", 200));
        String email = required(application.getEmail(), "邮箱", 200);
        if (!email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) throw new MyException("邮箱格式不正确");
        application.setEmail(email);
        application.setEmailType(option(application.getEmailType(), "邮箱类型", "ORGANIZATION", "PERSONAL"));
        String contact = application.getContactPerson() == null ? "" : application.getContactPerson().trim();
        if ("PERSONAL".equals(application.getEmailType())) contact = required(contact, "FAE 或渠道负责人", 100);
        if (contact.length() > 100) throw new MyException("FAE 或渠道负责人长度超过限制");
        application.setContactPerson(contact.isEmpty() ? null : contact);
        if ("SERVER".equals(application.getLicenseType())) {
            if (application.getMaxUsers() == null || application.getMaxUsers() < 1) throw new MyException("最大支持人数必须为正整数");
        } else application.setMaxUsers(null);
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
