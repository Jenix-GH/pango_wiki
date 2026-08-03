package com.pango.exception;

public class MyException extends RuntimeException{

    public MyException() {
        super();
    }

    public MyException(String msg) {
        super(msg);
    }

}