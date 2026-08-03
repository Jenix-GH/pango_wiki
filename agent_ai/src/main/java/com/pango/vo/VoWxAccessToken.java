package com.pango.vo;

import lombok.Data;

/**
 * 微信公众号获取的access_token
 */
@Data
public class VoWxAccessToken {

    private String access_token;
    private int expires_in;

}
