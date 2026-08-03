package com.pango.exception;

import com.pango.rs.R;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(MyException.class)
    public R handleBusinessException(MyException exception) {
        return R.error(exception.getMessage(), null);
    }

    @ExceptionHandler(Exception.class)
    public R handleException(Exception exception) {
        log.error("Unhandled request exception", exception);
        return R.error("服务暂时不可用，请稍后重试", null);
    }
}
