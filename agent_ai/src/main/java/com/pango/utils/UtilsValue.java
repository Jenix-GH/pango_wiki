package com.pango.utils;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

public class UtilsValue {

    //用于判断某个微信id是否在接收流数据
    public static Map<Integer, AtomicBoolean> streamFlags = new HashMap<>();
}
