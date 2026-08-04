package com.pango.exception;

import lombok.Getter;

@Getter
public class QuotaExceededException extends RuntimeException {
    private final int limit;
    private final int used;

    public QuotaExceededException(int limit, int used) {
        super("访客体验次数已用完，请登录后继续使用");
        this.limit = limit;
        this.used = Math.max(limit, used);
    }
}
