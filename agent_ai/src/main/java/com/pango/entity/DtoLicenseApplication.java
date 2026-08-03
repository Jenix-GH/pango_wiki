package com.pango.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.experimental.Accessors;

import java.util.Date;

@Data
@TableName("dto_license_application")
@Accessors(chain = true)
public class DtoLicenseApplication {
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private Long userinfoId;
    private String operatingSystem;
    private String softwareVersion;
    private String licenseType;
    private Integer durationYears;
    private String macAddress;
    private String applicantName;
    private String companyName;
    private String email;
    private String phone;
    private String address;
    private Integer status;
    private Date dotime;
    private Date uptime;
}
