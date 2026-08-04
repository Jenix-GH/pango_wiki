package com.pango.exception;

import com.pango.rs.R;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import java.util.HashMap;
import java.util.Map;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(QuotaExceededException.class)
    public ResponseEntity<R> handleQuotaExceeded(QuotaExceededException exception) {
        Map<String, Object> data = new HashMap<>();
        data.put("limit", exception.getLimit());
        data.put("used", exception.getUsed());
        data.put("remaining", 0);
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(R.error(4290, exception.getMessage(), data));
    }

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
