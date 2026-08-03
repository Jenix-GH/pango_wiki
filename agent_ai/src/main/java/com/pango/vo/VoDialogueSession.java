package com.pango.vo;

import lombok.Data;

/**
 * 向agent端获取SessionId的返回结果
 */
@Data
public class VoDialogueSession {

    private String answer;
    private String id;
    private String session_id;
    private Boolean running_status;

}
