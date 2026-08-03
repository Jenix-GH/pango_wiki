package com.pango.service;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.pango.exception.MyException;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import java.util.*;

public interface BaseService<T> extends IService<T> {

    /**
     * 根据ID查找对象,如果不存在,并判断是否抛出异常
     *
     * @param id        ID
     * @param exception true异常,其他返回空
     * @return obj
     */
    default T findCheckById(Integer id, Boolean exception) {
        T t = getById(id);
        if (null == t && exception) {
            throw new MyException("对象[ID:" + id + "]不能为空，请检查");
        }
        return t;
    }

    /**
     * 得到查询句柄
     *
     * @return LambdaQueryWrapper
     */
    default LambdaQueryWrapper<T> loadQw() {
        return new LambdaQueryWrapper<>();
    }

    /**
     * 验证并返日期区间值
     *
     * @param dateScopeTmp 日期区间拼接值
     * @return String[]
     */
    default String[] splitDateScope(Object dateScopeTmp) {
        String[] d = (dateScopeTmp + "").split(",");
        if (d.length != 2) {
            throw new MyException("日期区间参数不合法,请检查");
        }
        return d;
    }

    /**
     * ids 转 id, 用于单条删除或单条修改状态时,判断ids是否合法
     *
     * @param ids ID
     * @return id
     */
    default int idsToId(String ids) {
        int id = 0;
        try {
            id = Integer.parseInt(ids);
            assert id > 0;
        } catch (Exception e) {
            throw new MyException("仅允许单条删除,传入参数[" + ids + "]不合法");
        }
        return id;
    }

    /**
     * 将ID拼接的字符串转成id集合
     *
     * @param ids ids
     * @return Set
     */
    default Set<Integer> idsToSet(String ids) {
        Set<Integer> rs = new HashSet<>();
        for (String s : ids.split(",")) {
            if (null == s || "".equals(s.trim())) {
                continue;
            }
            rs.add(Integer.parseInt(s));
        }
        return rs;
    }

    /**
     * 将字符串转成Set集合
     *
     * @param str 带,号的字符串
     * @return Set
     */
    default Set<String> strToSet(String str) {
        String[] split = str.split(",");
        return new HashSet<>(Arrays.asList(split));
    }

    /**
     * 得到参数中的分页值
     *
     * @param params 参数
     * @return page
     */
    default Page<T> getPage(Map<String, Object> params) {
        int pageNum = Integer.parseInt(params.get("pageNum") + "");
        int pageSize = Integer.parseInt(params.get("pageSize") + "");
        return new Page<T>(pageNum, pageSize);
    }

    /**
     * 根据参数分页查询
     *
     * @param params 参数
     * @return Page
     */
    default IPage<T> findPageByParams(Map<String, Object> params) {
        LambdaQueryWrapper<T> qw = fillParams(params);
        return getBaseMapper().selectPage(getPage(params), qw);
    }

    /**
     * 根据参数列表查询
     *
     * @param params 参数
     * @return List
     */
    default List<T> findListByParams(Map<String, Object> params) {
        LambdaQueryWrapper<T> qw = fillParams(params);
        return getBaseMapper().selectList(qw);
    }

    /**
     * 构建查询句柄
     *
     * @param params 参数
     * @return LambdaQueryWrapper
     */
    LambdaQueryWrapper<T> fillParams(Map<String, Object> params);

    /**
     * 判断参数值是否为空
     *
     * @param obj Obj
     * @return boolean
     */
    default boolean paramNotNull(Object obj) {
        if (null == obj) {
            return false;
        }
        if (obj instanceof String) {
            if ("null".equals(obj + "")) {
                return false;
            }
        }
        return StringUtils.hasText(obj + "");
    }

    /**
     * 字符串转map
     *
     * @param mapStr key1:value1,key2:value2,...
     * @return Map
     */
    default Map<String, Object> strToMap(String mapStr) {
        String[] arr1 = mapStr.split(",");
        String[] arr2;
        Map<String, Object> map = new HashMap<>();
        for (String s : arr1) {
            arr2 = s.split(":");
            if (arr2.length != 2) {
                map.put(arr2[0], "");
                continue;
            }
            map.put(arr2[0], arr2[1]);
        }
        return map;
    }

    /**
     * 将list转成汇总格式
     *
     * @param list  List
     * @param field 汇总字段
     * @return map
     */
    default Map<String, Object> getMapByList(List<T> list, String field) {
        Map<String, Object> rs = new HashMap<>();
        rs.put("records", list);
        if (CollectionUtils.isEmpty(list)) {
            rs.put("sum", 0);
            rs.put("count", 0);
            return rs;
        }
        List<Map> maps = JSON.parseArray(JSON.toJSONString(list), Map.class);
        double sum = 0d;
        for (Map map : maps) {
            sum += Double.parseDouble(map.get(field) + "");
        }
        rs.put("sum", sum);
        rs.put("count", list.size());
        return rs;
    }

}