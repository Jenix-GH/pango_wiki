package com.pango.service;

import com.pango.entity.DtoUserinfo;
import com.pango.exception.MyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import javax.annotation.Resource;
import java.util.*;

/** Customer access is separate from the administrator's cookie-authenticated file API. */
@Service
public class ServiceLicensePortal {
    @Resource private ServiceAuth auth;
    @Resource private JdbcTemplate db;
    public long requireMember(String authorization) {
        DtoUserinfo user;
        try { user = auth.resolveUser(authorization); }
        catch (MyException e) { throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "请先登录后继续"); }
        if (user == null || user.getId() == null || "GUEST".equalsIgnoreCase(user.getUserType())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "请先登录后继续");
        }
        return user.getId();
    }

    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Map<String, Object> list(long owner, int page) {
        if (page < 1 || page > 100000) throw new MyException("页码无效");
        Long total = db.queryForObject("SELECT COUNT(*) FROM dto_license_application WHERE userinfo_id=? AND owner_verified=1", Long.class, owner);
        // Paginate verified applications first. Only the current customer/rejection dedupe key
        // counts as a mail attempt; FAE digests and archived rejection cycles must never match.
        List<Map<String, Object>> rows = db.queryForList(
                "SELECT a.*, DATE_FORMAT(a.dotime,'%Y-%m-%dT%H:%i:%s+08:00') AS submitted_at, " +
                "r.reason AS rejection_reason,r.state AS rejection_state,r.recipient AS rejection_recipient, " +
                "f.id AS file_id,f.state AS file_state,m.file_id AS mail_file_id,m.state AS mail_state," +
                "m.detail AS mail_detail,m.recipient AS mail_recipient,m.attempts AS mail_attempts " +
                "FROM (SELECT * FROM dto_license_application WHERE userinfo_id=? AND owner_verified=1 " +
                "ORDER BY dotime DESC,id DESC LIMIT 20 OFFSET ?) a " +
                "LEFT JOIN dto_license_rejection r ON r.application_id=a.id " +
                "LEFT JOIN dto_license_mail m ON m.application_id=a.id AND m.kind=IF(a.status=3,'rejection','customer') " +
                "AND m.dedupe_key=CONCAT(IF(a.status=3,'rejection:','customer:'),a.id) " +
                "LEFT JOIN dto_license_file f ON a.status<>3 AND f.id=(SELECT f2.id FROM dto_license_file f2 " +
                "WHERE f2.application_id=a.id AND f2.state<>'duplicate' " +
                "ORDER BY (f2.state='cancelled'),f2.uploaded_at DESC,f2.id DESC LIMIT 1) " +
                "ORDER BY a.dotime DESC,a.id DESC", owner, (page - 1) * 20);
        List<Map<String, Object>> records = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id"));
            item.put("submittedAt", row.get("submitted_at"));
            item.put("operatingSystem", row.get("operating_system"));
            item.put("softwareVersion", row.get("software_version"));
            item.put("licenseType", row.get("license_type"));
            item.put("durationYears", row.get("duration_years"));
            item.put("emailType", row.get("email_type"));
            item.put("contactPerson", row.get("contact_person"));
            item.put("maxUsers", row.get("max_users"));
            item.put("macAddress", row.get("mac_address"));
            Object official = row.get("official_submitted");
            item.put("officialSubmitted", official == null ? null : Boolean.TRUE.equals(official) || "1".equals(String.valueOf(official)));
            item.put("status", row.get("status"));
            item.put("rejectionReason", number(row.get("status")) == 3 ? row.get("rejection_reason") : null);
            item.put("mail", memberMail(row));
            // Old clients must never offer a download, even before their next release.
            item.put("canDownload", false);
            item.put("filename", null);
            records.add(item);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("records", records); result.put("total", total); result.put("page", page); result.put("pageSize", 20);
        return result;
    }

    private Map<String, String> memberMail(Map<String,Object> row) {
        int progress = number(row.get("status"));
        boolean rejection = progress == 3;
        String kind = rejection ? "拒绝说明" : "License";
        String queue = Objects.toString(row.get(rejection ? "rejection_state" : "file_state"), "");
        String attempt = Objects.toString(row.get("mail_state"), "");
        String detail = Objects.toString(row.get("mail_detail"), "");
        String target = mask(row.get("mail_recipient"));
        if ("accepted".equals(attempt))
            return message("sent", kind + "已发送至邮箱", target.isEmpty() ? "请查收申请邮箱。" : target + " · 请查收邮件" + (rejection ? "。" : "及附件。"));
        if ("unknown".equals(attempt) || "unknown".equals(queue))
            return message("unknown", "邮件发送结果待核查", "暂无法确认是否发出，请联系对接 FAE。");
        if ("sending".equals(attempt) || "sending".equals(queue))
            return message("sending", kind + "正在发送", "稍后刷新可查看结果。");
        if ("paused".equals(queue) || "cancelled".equals(queue) || "cancelled".equals(attempt))
            return message("stopped", "邮件已暂停或取消", "如需了解进展，请联系对接 FAE。");
        // A replaced file or an explicitly requeued notice should not inherit an old failure.
        boolean currentAttempt = rejection || row.get("file_id")==null || Objects.equals(row.get("file_id"),row.get("mail_file_id"));
        if ("failed".equals(attempt) && currentAttempt && !("queued".equals(queue) && number(row.get("mail_attempts"))==0)) {
            if (detail.startsWith("收件地址被拒收：") || "邮件服务明确拒绝：SMTPRecipientsRefused".equals(detail) || "所有收件人被邮件服务拒绝".equals(detail))
                return message("refused", "收件地址被拒收", "请核对申请邮箱" + (target.isEmpty() ? "" : " " + target) + "，并联系对接 FAE。");
            return message("failed", "邮件发送失败", "请联系对接 FAE 核查发送结果。");
        }
        if ("queued".equals(queue)) {
            String mailbox = mask(row.get(rejection ? "rejection_recipient" : "email"));
            return message("queued", kind + "待发送", mailbox.isEmpty() ? "正在等待发信。" : "邮件将发送至申请邮箱：" + mailbox + "。");
        }
        if ("failed".equals(queue)) return message("failed", "邮件发送失败", "请联系对接 FAE 核查发送结果。");
        if ((progress==0 || progress==1) && row.get("official_submitted")!=null && queue.isEmpty())
            return message("not_sent", "尚未发送", progress==0 ? "申请已提交，可在此查看进展。" : "申请正在处理中。");
        return message("no_record", "暂无邮件发送记录", "当前没有可核实的客户邮件发送记录。");
    }

    private static Map<String,String> message(String state,String label,String note) {
        Map<String,String> result=new LinkedHashMap<>();
        result.put("state",state); result.put("label",label); result.put("note",note);
        return result;
    }
    private static String mask(Object raw) {
        String email = Objects.toString(raw, "").trim();
        if (!email.matches("[^\\s@,;<>]+@[^\\s@,;<>]+")) return "";
        int at = email.indexOf('@');
        return email.substring(0, Math.min(at,2)) + "***" + email.substring(at);
    }
    private static int number(Object value) { return value instanceof Number ? ((Number) value).intValue() : -1; }
}
