package com.pango.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class ServiceAdminConsole {
    @Resource private JdbcTemplate jdbcTemplate;

    public Map<String, Object> dashboard(int days) {
        LocalDate startDate = LocalDate.now().minusDays(days - 1L);
        Timestamp start = Timestamp.valueOf(startDate.atStartOfDay());
        Map<String, Object> result = new HashMap<>();
        result.put("summary", jdbcTemplate.queryForMap(
                "SELECT " +
                        "SUM(event_name='page_view') pv, " +
                        "COUNT(DISTINCT CASE WHEN event_name='page_view' THEN visitor_id END) uv, " +
                        "SUM(event_name='chat_submit') chat_submit, " +
                        "SUM(event_name='chat_success') chat_success, " +
                        "SUM(event_name='chat_failed') chat_failed, " +
                        "SUM(event_name='document_read') document_read, " +
                        "SUM(event_name='document_download') document_download " +
                        "FROM dto_analytics_event WHERE event_time >= ?", start));
        result.put("trend", jdbcTemplate.queryForList(
                "SELECT DATE(event_time) stat_date, " +
                        "SUM(event_name='page_view') pv, " +
                        "COUNT(DISTINCT CASE WHEN event_name='page_view' THEN visitor_id END) uv, " +
                        "SUM(event_name='chat_submit') chat_submit " +
                        "FROM dto_analytics_event WHERE event_time >= ? " +
                        "GROUP BY DATE(event_time) ORDER BY stat_date", start));
        result.put("eventBreakdown", jdbcTemplate.queryForList(
                "SELECT event_name, client_type, COUNT(*) event_count, COUNT(DISTINCT visitor_id) user_count " +
                        "FROM dto_analytics_event WHERE event_time >= ? " +
                        "GROUP BY event_name, client_type ORDER BY event_count DESC", start));
        result.put("popularDocuments", jdbcTemplate.queryForList(
                "SELECT document_id, COUNT(*) read_count, COUNT(DISTINCT visitor_id) reader_count " +
                        "FROM dto_analytics_event WHERE event_time >= ? AND event_name='document_read' " +
                        "AND document_id IS NOT NULL GROUP BY document_id ORDER BY read_count DESC LIMIT 10", start));
        result.put("pendingFeedback", count("dto_feedback", 0));
        result.put("pendingLicense", count("dto_license_application", 0));
        return result;
    }

    public Map<String, Object> events(int page, int pageSize, String eventName, String clientType) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (notBlank(eventName)) {
            where.append(" AND event_name=?");
            args.add(eventName.trim().toLowerCase());
        }
        if (notBlank(clientType)) {
            where.append(" AND client_type=?");
            args.add(clientType.trim().toUpperCase());
        }
        return page("dto_analytics_event", where.toString(), args, page, pageSize, "event_time DESC");
    }

    public Map<String, Object> feedback(int page, int pageSize, Integer status) {
        String where = status == null ? " WHERE 1=1" : " WHERE status=?";
        List<Object> args = new ArrayList<>();
        if (status != null) args.add(status);
        return page("dto_feedback", where, args, page, pageSize, "dotime DESC");
    }

    public Map<String, Object> licenses(int page, int pageSize, Integer status) {
        String where = status == null ? " WHERE 1=1" : " WHERE status=?";
        List<Object> args = new ArrayList<>();
        if (status != null) args.add(status);
        return page("dto_license_application", where, args, page, pageSize, "dotime DESC");
    }

    public void updateFeedbackStatus(long id, int status) {
        requireUpdated(jdbcTemplate.update("UPDATE dto_feedback SET status=?, uptime=NOW() WHERE id=?", status, id));
    }

    public void updateLicenseStatus(long id, int status) {
        requireUpdated(jdbcTemplate.update("UPDATE dto_license_application SET status=?, uptime=NOW() WHERE id=?", status, id));
    }

    private Map<String, Object> page(String table, String where, List<Object> args, int page,
                                     int pageSize, String orderBy) {
        int offset = (page - 1) * pageSize;
        Long total = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + table + where, args.toArray(), Long.class);
        List<Object> recordArgs = new ArrayList<>(args);
        recordArgs.add(pageSize);
        recordArgs.add(offset);
        List<Map<String, Object>> records = jdbcTemplate.queryForList(
                "SELECT * FROM " + table + where + " ORDER BY " + orderBy + " LIMIT ? OFFSET ?",
                recordArgs.toArray());
        Map<String, Object> result = new HashMap<>();
        result.put("records", records);
        result.put("total", total == null ? 0 : total);
        result.put("page", page);
        result.put("pageSize", pageSize);
        return result;
    }

    private long count(String table, int status) {
        Long value = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE status=?", Long.class, status);
        return value == null ? 0 : value;
    }

    private boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private void requireUpdated(int updated) {
        if (updated != 1) throw new IllegalArgumentException("记录不存在");
    }
}
