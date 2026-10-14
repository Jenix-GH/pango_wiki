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
    private Boolean officialSubmitted;
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Boolean ownerVerified;
    private String operatingSystem;
    private String softwareVersion;
    private String licenseType;
    private Integer durationYears;
    private String macAddress;
    private String applicantName;
    private String companyName;
    private String email;
    private String emailType;
    private String contactPerson;
    @com.fasterxml.jackson.databind.annotation.JsonDeserialize(using = LicenseIntegerDeserializer.class)
    private Integer maxUsers;
    private String phone;
    private String address;
    private Integer status;
    private Date dotime;
    private Date uptime;

    public static class LicenseIntegerDeserializer extends com.fasterxml.jackson.databind.JsonDeserializer<Integer> {
        @Override public Integer deserialize(com.fasterxml.jackson.core.JsonParser parser,
                com.fasterxml.jackson.databind.DeserializationContext context) throws java.io.IOException {
            if (!parser.hasToken(com.fasterxml.jackson.core.JsonToken.VALUE_NUMBER_INT)) {
                throw com.fasterxml.jackson.databind.JsonMappingException.from(parser, "最大支持人数必须为整数");
            }
            return parser.getIntValue();
        }
    }
}
