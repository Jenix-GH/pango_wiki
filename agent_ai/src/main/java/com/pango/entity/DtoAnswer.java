package com.pango.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.experimental.Accessors;
import java.util.Date;

@Data
@TableName("dto_answer")
@Accessors(chain = true)
public class DtoAnswer {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private Long userinfoId; //用户ID
    private Long questionId; //问题内容
    private String think; //问题日期
    private String content; //问题日期
    private Date questionEnd; //问题结束日期
    private String answerTime; //回答时间
    private Date dotime; //创建时间
    private Date uptime;
    private Integer flagEvaluate; //评价，0：未评价，1：赞，-1：踩
    private String reference;//参考资料，json格式

    @TableField(exist = false)
    private Long count; //单个用户的回答数量

}
