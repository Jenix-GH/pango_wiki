package com.pango.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.experimental.Accessors;

import java.util.Date;
import java.util.List;

@Data
@TableName("dto_question")
@Accessors(chain = true)
public class DtoQuestion {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private Long userinfoId; //用户ID
    private String questionType; //问题类型
    private String question; //问题内容
//    private Integer internetEnable; //联网搜索
    private String doDate; //问题日期
    private Date dotime; //创建时间
    private Date uptime;
    private Integer flagDel;//删除标志

    @TableField(exist = false)
    private List<DtoQuestion> todayQuestion;

    @TableField(exist = false)
    private List<DtoQuestion> weekQuestion;

    @TableField(exist = false)
    private Long count; //单个用户的回答数量
    @TableField(exist = false)
    private boolean flagCompanyInfo; //是否有公司信息

}
