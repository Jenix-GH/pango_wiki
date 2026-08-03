package com.pango.utils;

import com.alibaba.fastjson.JSON;
import com.pango.enums.EnumBaseParams;
import com.pango.exception.MyException;
import org.springframework.util.CollectionUtils;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public interface MyAssert {

    /**
     * 判断参数是否为空字符
     * @param str 参数值
     * @param msg 参数名称
     * @return String
     */
    default String strIsNull(Object str, String msg){
        String message;
        String format0 = "字符参数不能为空值";
        String format1 = "字符参数[%s]不能为空值";
        if(null == msg || msg.length() <= 0){
            message = format0;
        }else{
            if(msg.startsWith("-")){
                message = msg.substring(1);
            }else{
                message = String.format(format1, msg);
            }
        }
        if(null == str){
            throw new MyException(message);
        }
        String rs = str + "";
        if("".equals(rs.trim())){
            throw new MyException(message);
        }
        return rs;
    }

    /**
     * 判断参数是否为整型数字类型
     * @param str 参数内容
     * @param msg 参数名称
     * @return int
     */
    default int intIsNull(Object str, String msg) {
        String message;
        String format0 = "数字参数不能为空值";
        String format1 = "数字参数[%s]不能为空值";
        if(null == msg || msg.length() <= 0){
            message = format0;
        }else{
            if(msg.startsWith("-")){
                message = msg.substring(1);
            }else{
                message = String.format(format1, msg);
            }
        }
        if(null == str){
            throw new MyException(message);
        }
        String rs = str + "";
        if("".equals(rs.trim())){
            throw new MyException(message);
        }
        try{
            return Integer.parseInt(rs);
        }catch (Exception e){
            throw new MyException(message);
        }
    }

    /**
     * 校验日期区间格式是否合法
     * @param dates 日期字符串，如2022-09-01,2022-09-10
     * @return ["2022-09-01","2022-09-10"]
     */
    default String[] dateScopeIsValid(String dates){
        String[] rs = dates.split(",");
        if(rs.length != 2){
            throw new MyException("日期区间["+dates+"]格式不合法，请检查");
        }
        return rs;
    }

    /**
     * 判断参数是否为正整数
     * @param str 参数内容
     * @param msg 参数名称
     * @return int
     */
    default int idIsNull(Object str, String msg) {
        String message;
        String format0 = "数字参数不能为空值";
        String format1 = "数字参数[%s]不能为空值";
        if(null == msg || msg.length() <= 0){
            message = format0;
        }else{
            if(msg.startsWith("-")){
                message = msg.substring(1);
            }else{
                message = String.format(format1, msg);
            }
        }
        if(null == str){
            throw new MyException(message);
        }
        String rs = str + "";
        if("".equals(rs.trim())){
            throw new MyException(message);
        }
        try{
            int id = Integer.parseInt(rs);
            if(id <= 0){
                throw new MyException(message);
            }
            return id;
        }catch (Exception e){
            throw new MyException(message);
        }
    }

    /**
     * 判断参数是否为正整数
     * @param str 参数内容
     * @param msg 参数名称
     * @return int
     */
    default double doubleIsNull(Object str, String msg) {
        String message;
        String format0 = "小数参数不能为空值";
        String format1 = "小数参数[%s]不能为空值";
        if(null == msg || msg.length() <= 0){
            message = format0;
        }else{
            if(msg.startsWith("-")){
                message = msg.substring(1);
            }else{
                message = String.format(format1, msg);
            }
        }
        if(null == str){
            throw new MyException(message);
        }
        String rs = str + "";
        if("".equals(rs.trim())){
            throw new MyException(message);
        }
        try{
            return Double.parseDouble(rs);
        }catch (Exception e){
            throw new MyException(message);
        }
    }

    /**
     * 判断参数是否为正整数
     * @param str 参数内容
     * @param msg 参数名称
     * @return int
     */
    default double doubleIsNullZero(Object str, String msg) {
        String message;
        String format0 = "小数参数不能为空值";
        String format1 = "小数参数[%s]不能为空值";
        if(null == msg || msg.length() <= 0){
            message = format0;
        }else{
            if(msg.startsWith("-")){
                message = msg.substring(1);
            }else{
                message = String.format(format1, msg);
            }
        }
        if(null == str){
            throw new MyException(message);
        }
        String rs = str + "";
        if("".equals(rs.trim())){
            throw new MyException(message);
        }
        try{
            double v = Double.parseDouble(rs);
            if(v > 0){
                return v;
            }
            message = String.format(format1, msg);
            throw new MyException(message);
        }catch (Exception e){
            throw new MyException(message);
        }
    }

    /**
     * 判断分页参数是否合法
     * @param params 分页参数集合，pageNum,pageSize
     */
    default void pageIsNull(Map<String, Object> params){
        Object tmp = params.get(EnumBaseParams.pageNum.toString());
        if(null == tmp || "".equals(tmp + "")){
            throw new MyException("分页参数pageNum不能为空值");
        }
        try {
            Integer.parseInt(tmp + "");
        }catch (Exception e){
            throw new MyException("分页参数pageNum["+tmp+"]不合法");
        }
        tmp = params.get(EnumBaseParams.pageSize.toString());
        if(null == tmp || "".equals(tmp + "")){
            throw new MyException("分页参数pageSize不能为空值");
        }
        try {
            Integer.parseInt(tmp + "");
        }catch (Exception e){
            throw new MyException("分页参数pageSize["+tmp+"]不合法");
        }
    }

    /**
     * 判断状态值是否在某个范围之内
     * @param status 状态值
     * @param statusArrays 范围
     */
    default void statusIsValid(int status, int[] statusArrays){
        boolean flag = false;
        for(int i : statusArrays){
            if(i == status){
                flag = true;
                break;
            }
        }
        if(!flag){
            throw new MyException("状态/参数["+status+"]不在指定范围内，请检查");
        }
    }

    /**
     * 判断状态值是否在某个范围之内
     * @param str 状态值
     * @param strArrays 范围
     */
    default void strIsValid(String str, String[] strArrays){
        boolean flag = false;
        for(String i : strArrays){
            if(i.equals(str)){
                flag = true;
                break;
            }
        }
        if(!flag){
            throw new MyException("参数["+str+"]不在指定范围内，请检查");
        }
    }

    /**
     * 将list转成汇总格式
     * @param list List
     * @param field 汇总字段
     * @return map
     */
    default Map<String, Object> getMapByList(List list, String field) {
        Map<String, Object> rs = new HashMap<>();
        rs.put("records", list);
        if(CollectionUtils.isEmpty(list)){
            rs.put("sum", 0);
            rs.put("count", 0);
            return rs;
        }
        List<Map> maps = JSON.parseArray(JSON.toJSONString(list), Map.class);
        double sum = 0d;
        for(Map map : maps){
            sum += Double.parseDouble(map.get(field) + "");
        }
        rs.put("sum", sum);
        rs.put("count", list.size());
        return rs;
    }

    /**
     * 取list汇总
     * @param list List
     * @param field 汇总字段
     * @return map
     */
    default Map<String, Object> getSumByList(List list, String field) {
        Map<String, Object> rs = new HashMap<>();
        if(CollectionUtils.isEmpty(list)){
            rs.put("sum", 0);
            rs.put("count", 0);
            return rs;
        }
        List<Map> maps = JSON.parseArray(JSON.toJSONString(list), Map.class);
        double sum = 0d;
        for(Map map : maps){
            sum += Double.parseDouble(map.get(field) + "");
        }
        rs.put("sum", sum);
        rs.put("count", list.size());
        return rs;
    }

    /**
     * 开始日期补充时间
     * @param date 开始日期
     * @return String
     */
    default String dateSupplementStartTime(String date){
        if(date.length() == 10){
            return date + " 00:00:00";
        }
        return date;
    }

    /**
     * 结束日期结束时间
     * @param date 结束日期
     * @return String
     */
    default String dateSupplementEndTime(String date){
        if(date.length() == 10){
            return date + " 23:59:59";
        }
        return date;
    }
}
