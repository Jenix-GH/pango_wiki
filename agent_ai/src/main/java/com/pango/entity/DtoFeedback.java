package com.pango.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.experimental.Accessors;

import java.util.Date;

@Data
@TableName("dto_feedback")
@Accessors(chain = true)
public class DtoFeedback {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private Long userinfoId;
    private String sessionId;
    private String platform;
    private String feedbackType;
    private String detail;
    private String questionContent;
    private String answerContent;
    private String contactName;
    private String companyName;
    private String email;
    private String phone;
    private Integer status;
    private Date dotime;
    private Date uptime;
}
