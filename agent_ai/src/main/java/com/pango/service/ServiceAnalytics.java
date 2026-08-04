package com.pango.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pango.entity.DtoAnalyticsEvent;
import com.pango.mapper.MapperAnalyticsEvent;
import org.springframework.stereotype.Service;
import lombok.extern.slf4j.Slf4j;

import java.util.Date;

@Service
@Slf4j
public class ServiceAnalytics extends ServiceImpl<MapperAnalyticsEvent, DtoAnalyticsEvent> {
    public void record(String eventName, String pagePath, String clientType, Long userId,
                       String sessionId, String documentId, String ipAddress, String userAgent) {
        save(new DtoAnalyticsEvent()
                .setEventName(eventName)
                .setPagePath(pagePath == null ? "" : pagePath)
                .setClientType(clientType)
                .setVisitorId("user_" + userId)
                .setUserinfoId(userId)
                .setSessionId(sessionId)
                .setDocumentId(documentId)
                .setIpAddress(ipAddress)
                .setUserAgent(userAgent)
                .setEventTime(new Date()));
    }

    public void recordQuietly(String eventName, String pagePath, String clientType, Long userId,
                              String sessionId, String documentId) {
        try {
            record(eventName, pagePath, clientType, userId, sessionId, documentId, null, null);
        } catch (RuntimeException exception) {
            log.warn("Failed to persist analytics event: {}", eventName, exception);
        }
    }
}
