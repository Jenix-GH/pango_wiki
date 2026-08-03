package com.pango.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.experimental.Accessors;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.Date;
import java.util.List;

@Data
@TableName("dto_userinfo")
@Accessors(chain = true)
public class DtoUserinfo {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private String wxCode;
    private String nickName;
    private String phoneNumber;
    @JsonIgnore
    private String passwordHash;
    private String mailAddress;
    private String companyName;
    private String jobName;
    private Date dotime;
    private Date uptime;

    @TableField(exist = false)
    private Integer flagUseData;
    @TableField(exist = false)
    private Long setId;
    @TableField(exist = false)
    private List<DtoQuestion> todayQuestionList;
    @TableField(exist = false)
    private List<DtoQuestion> weekQuestionList;
    @TableField(exist = false)
    private Long count;
    @TableField(exist = false)
    private boolean flagCompanyInfo;

}
