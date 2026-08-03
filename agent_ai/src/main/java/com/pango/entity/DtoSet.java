package com.pango.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.experimental.Accessors;

import java.util.Date;

@Data
@TableName("dto_set")
@Accessors(chain = true)
public class DtoSet {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private Long userinfoId;
    private Integer dataUseFlag;
    private String serviceProtocol;
    private String about;
    private Date dotime;
    private Date uptime;

}
