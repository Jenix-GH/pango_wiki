package com.pango.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pango.entity.DtoUserinfo;
import com.pango.exception.MyException;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import javax.annotation.Resource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Customer access is separate from the administrator's cookie-authenticated file API. */
@Service
public class ServiceLicensePortal {
    @Resource private ServiceAuth auth;
    @Resource private JdbcTemplate db;
    private final ObjectMapper json = new ObjectMapper();
    private static final List<String> SNAPSHOT_KEYS = Arrays.asList("id", "mac_address", "email", "operating_system",
            "software_version", "license_type", "duration_years", "applicant_name", "company_name");
    private static final Set<String> DOWNLOAD_STATES = new HashSet<>(Arrays.asList("queued", "accepted", "failed"));
    private static final String FILE_METADATA = "id,original_name,mac,sha256,byte_length,application_snapshot,state,manual_selection";

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
        List<Map<String, Object>> rows = db.queryForList("SELECT a.*, DATE_FORMAT(a.dotime,'%Y-%m-%dT%H:%i:%s+08:00') AS submitted_at, r.reason AS rejection_reason FROM dto_license_application a " +
                "LEFT JOIN dto_license_rejection r ON r.application_id=a.id WHERE a.userinfo_id=? AND a.owner_verified=1 " +
                "ORDER BY a.dotime DESC,a.id DESC LIMIT 20 OFFSET ?", owner, (page - 1) * 20);
        List<Map<String, Object>> records = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id"));
            item.put("submittedAt", row.get("submitted_at"));
            item.put("operatingSystem", row.get("operating_system"));
            item.put("softwareVersion", row.get("software_version"));
            item.put("licenseType", row.get("license_type"));
            item.put("durationYears", row.get("duration_years"));
            item.put("macAddress", row.get("mac_address"));
            Object official = row.get("official_submitted");
            item.put("officialSubmitted", official == null ? null : Boolean.TRUE.equals(official) || "1".equals(String.valueOf(official)));
            item.put("status", row.get("status"));
            item.put("rejectionReason", number(row.get("status")) == 3 ? row.get("rejection_reason") : null);
            Map<String, Object> file = eligibleFile(row, false);
            item.put("canDownload", file != null);
            item.put("filename", file == null ? null : file.get("original_name"));
            records.add(item);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("records", records); result.put("total", total); result.put("page", page); result.put("pageSize", 20);
        return result;
    }

    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public ResponseEntity<byte[]> download(long owner, long id) {
        List<Map<String, Object>> applications = db.queryForList(
                "SELECT * FROM dto_license_application WHERE id=? AND userinfo_id=? AND owner_verified=1", id, owner);
        if (applications.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "申请不存在或无权访问");
        Map<String, Object> file = eligibleFile(applications.get(0), true);
        if (file == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "License 暂不可下载，请稍后刷新");
        byte[] content = (byte[]) file.get("content");
        if (!validContent(file, content)) throw new ResponseStatusException(HttpStatus.CONFLICT, "文件校验失败，请联系管理员重新上传");
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(String.valueOf(file.get("original_name")), StandardCharsets.UTF_8).build().toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store, private")
                .header("X-Content-Type-Options", "nosniff").contentLength(content.length).body(content);
    }

    private Map<String, Object> eligibleFile(Map<String, Object> row, boolean includeContent) {
        if (number(row.get("status")) < 0 || number(row.get("status")) > 2) return null;
        List<Map<String, Object>> files = db.queryForList("SELECT " + FILE_METADATA + (includeContent ? ",content" : "") +
                " FROM dto_license_file WHERE application_id=? AND state NOT IN ('cancelled','duplicate')", row.get("id"));
        if (files.size() != 1 || !validMetadata(row, files.get(0))) return null;
        Map<String, Object> file = files.get(0);
        // A later upload can introduce ambiguity before the nightly worker revalidates this file.
        Long conflicts = db.queryForObject("SELECT COUNT(*) FROM dto_license_file WHERE mac=? AND id<>? " +
                "AND state IN ('queued','conflict','unmatched','paused','failed','unknown','sending')", Long.class, file.get("mac"), file.get("id"));
        if (conflicts == null || conflicts != 0) return null;
        if (!"accepted".equals(file.get("state")) && number(file.get("manual_selection")) != 1) {
            Long candidates = db.queryForObject("SELECT COUNT(*) FROM dto_license_application a WHERE " +
                    "UPPER(REPLACE(REPLACE(a.mac_address,'-',''),':',''))=? AND a.status IN (0,1,2) " +
                    "AND NOT EXISTS (SELECT 1 FROM dto_license_mail m WHERE m.application_id=a.id AND m.kind='customer' AND m.state IN ('accepted','unknown','sending'))",
                    Long.class, file.get("mac"));
            if (candidates == null || candidates != 1) return null;
        }
        return file;
    }

    boolean validMetadata(Map<String, Object> row, Map<String, Object> file) {
        if (!DOWNLOAD_STATES.contains(String.valueOf(file.get("state")))) return false;
        String mac = String.valueOf(row.get("mac_address")).replace("-", "").replace(":", "").toUpperCase(Locale.ROOT);
        if (!mac.matches("[0-9A-F]{12}") || !mac.equalsIgnoreCase(String.valueOf(file.get("mac"))) ||
                !("new_pds_" + mac + ".lic").equalsIgnoreCase(String.valueOf(file.get("original_name")))) return false;
        try {
            Map<String, String> snapshot = json.readValue(String.valueOf(file.get("application_snapshot")), new TypeReference<Map<String, String>>() {});
            for (String key : SNAPSHOT_KEYS) {
                if (!Objects.equals(String.valueOf(row.getOrDefault(key, "")), snapshot.get(key))) return false;
            }
        } catch (Exception e) { return false; }
        return number(file.get("byte_length")) > 0 && number(file.get("byte_length")) <= 1024 * 1024;
    }

    boolean validContent(Map<String, Object> file, byte[] content) {
        if (content == null || content.length != number(file.get("byte_length"))) return false;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(content);
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format("%02x", b & 0xff));
            return hex.toString().equalsIgnoreCase(String.valueOf(file.get("sha256")));
        } catch (Exception e) { return false; }
    }

    private static int number(Object value) { return value instanceof Number ? ((Number) value).intValue() : -1; }
}
