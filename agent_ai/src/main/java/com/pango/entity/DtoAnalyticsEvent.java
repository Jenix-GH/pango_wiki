package com.pango.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.experimental.Accessors;

import java.util.Date;

@Data
@TableName("dto_analytics_event")
@Accessors(chain = true)
public class DtoAnalyticsEvent {
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private String eventName;
    private String pagePath;
    private String clientType;
    private String visitorId;
    private Long userinfoId;
    private String sessionId;
    private String documentId;
    private String ipAddress;
    private String userAgent;
    private Date eventTime;
}
