package com.pango.rs;

import lombok.Data;

@Data
public class R {

    private int code;
    private String message;
    private Object data;

    public static R ok(Object data) {
        R r = new R();
        r.setCode(2000);
        r.setMessage("success");
        r.setData(data);
        return r;
    }

    public static R ok() {
        R r = new R();
        r.setCode(2000);
        r.setMessage("success");
        return r;
    }

    public static R error(String message, Object data) {
        R r = new R();
        r.setCode(4001);
        r.setMessage(message);
        r.setData(data);
        return r;
    }

}
