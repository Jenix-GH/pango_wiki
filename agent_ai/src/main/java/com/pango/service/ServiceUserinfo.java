package com.pango.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pango.entity.DtoSet;
import com.pango.entity.DtoUserinfo;
import com.pango.mapper.MapperUserinfo;
import com.pango.exception.MyException;
import com.pango.exception.QuotaExceededException;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;

/**
 * 用户信息服务实现类
 */
@Transactional
@Service
public class ServiceUserinfo extends ServiceImpl<MapperUserinfo, DtoUserinfo> implements BaseService<DtoUserinfo> {
    public static final int GUEST_QUOTA_LIMIT = 50;
    @Override
    public LambdaQueryWrapper<DtoUserinfo> fillParams(Map<String, Object> params) {
        return null;
    }

    @Lazy
    @Resource
    private ServiceSet serviceSet;

    /**
     * 添加用户信息
     */
    public DtoUserinfo doAdd(String wxCode, String nickName){
        //获取用户信息
        DtoUserinfo userinfo = getByPhone(wxCode);
        if(null == userinfo){ // 空值,需要新增信息
            // 新增用户信息
            userinfo = new DtoUserinfo().setWxCode(wxCode).setPhoneNumber(wxCode).setNickName(nickName);
            this.save(userinfo);
            // 新增设置信息
            DtoSet set = new DtoSet().setUserinfoId(userinfo.getId()).setDataUseFlag(1);
            serviceSet.save(set);
            // 增加人员的设置信息
            userinfo.setSetId(set.getId()).setFlagUseData(1);
            return userinfo;
        }
        if (userinfo.getPhoneNumber() == null || userinfo.getPhoneNumber().trim().isEmpty()) {
            userinfo.setPhoneNumber(wxCode);
            this.updateById(userinfo);
        }
        // 判断有无设置信息
        if(null == userinfo.getSetId() || userinfo.getSetId() <= 0){ //表示没有设置信息
            // 新增设置信息
            DtoSet set = new DtoSet().setUserinfoId(userinfo.getId()).setDataUseFlag(1);
            serviceSet.save(set);
            // 增加人员的设置信息
            userinfo.setSetId(set.getId()).setFlagUseData(1);
        }
        return userinfo;
    }

    /**
     * 修改用户信息
     * @param obj DtoUserinfo
     */
    public DtoUserinfo doUpdate(DtoUserinfo obj){
        this.saveOrUpdate(obj);
        return getByUserId(Math.toIntExact(obj.getId()));
    }

    /**
     * 根据id获取到对象
     * @param id ID
     * @return DtoUserinfo
     */
    public DtoUserinfo getByUserId(int id){
        DtoUserinfo userinfo = findCheckById(id, true);
        DtoSet set = serviceSet.findByUserId(Math.toIntExact(userinfo.getId()));
        if(null != set){
            userinfo.setFlagUseData(set.getDataUseFlag()).setSetId(set.getId());
        }
        return userinfo;
    }


    /**
     * 根据微信号获取用户信息
     * @param wxCode 微信号或手机号
     */
    public DtoUserinfo getByWxCode(String wxCode){
        LambdaQueryWrapper<DtoUserinfo> qw = loadQw();
        qw.eq(DtoUserinfo::getWxCode, wxCode);
        List<DtoUserinfo> list = this.list(qw);
        if(CollectionUtils.isEmpty(list)){
            return null;
        }
        DtoUserinfo rs = list.get(0);
        //如果存在，则需要进一步查找设置信息
        DtoSet set = serviceSet.findByUserId(Math.toIntExact(list.get(0).getId()));
        if(null != set){
            list.get(0).setFlagUseData(set.getDataUseFlag()).setSetId(set.getId());
        }
        return rs;
    }

    public DtoUserinfo getByPhone(String phone) {
        LambdaQueryWrapper<DtoUserinfo> qw = loadQw();
        qw.eq(DtoUserinfo::getPhoneNumber, phone).or().eq(DtoUserinfo::getWxCode, phone);
        List<DtoUserinfo> list = this.list(qw);
        if (CollectionUtils.isEmpty(list)) return null;
        DtoUserinfo userinfo = list.get(0);
        DtoSet set = serviceSet.findByUserId(Math.toIntExact(userinfo.getId()));
        if (set != null) userinfo.setFlagUseData(set.getDataUseFlag()).setSetId(set.getId());
        return userinfo;
    }

    public DtoUserinfo createPhoneUser(String phone, String nickName, String passwordHash) {
        DtoUserinfo userinfo = new DtoUserinfo()
                .setWxCode(phone)
                .setPhoneNumber(phone)
                .setNickName(nickName)
                .setPasswordHash(passwordHash);
        this.save(userinfo);
        DtoSet set = new DtoSet().setUserinfoId(userinfo.getId()).setDataUseFlag(1);
        serviceSet.save(set);
        return userinfo.setSetId(set.getId()).setFlagUseData(1);
    }

    public DtoUserinfo getOrCreateGuest(String guestKey, String platform) {
        String wxCode = "guest:" + platform + ":" + guestKey;
        DtoUserinfo userinfo = getByWxCode(wxCode);
        if (userinfo != null) return withQuota(userinfo);
        userinfo = new DtoUserinfo()
                .setWxCode(wxCode)
                .setNickName("访客")
                .setUserType("GUEST")
                .setQuotaUsed(0)
                .setDotime(new java.util.Date())
                .setUptime(new java.util.Date());
        this.save(userinfo);
        DtoSet set = new DtoSet().setUserinfoId(userinfo.getId()).setDataUseFlag(1);
        serviceSet.save(set);
        return withQuota(userinfo.setSetId(set.getId()).setFlagUseData(1));
    }

    public DtoUserinfo consumeGuestQuota(long userId) {
        DtoUserinfo user = getById(userId);
        if (user == null) throw new MyException("用户不存在");
        if (!"GUEST".equals(user.getUserType())) return user;
        if (baseMapper.consumeGuestQuota(userId, GUEST_QUOTA_LIMIT) == 0) {
            throw new QuotaExceededException(GUEST_QUOTA_LIMIT,
                    user.getQuotaUsed() == null ? 0 : user.getQuotaUsed());
        }
        user.setQuotaUsed((user.getQuotaUsed() == null ? 0 : user.getQuotaUsed()) + 1);
        return withQuota(user);
    }

    public DtoUserinfo withQuota(DtoUserinfo user) {
        if (user == null) return null;
        int used = user.getQuotaUsed() == null ? 0 : user.getQuotaUsed();
        boolean guest = "GUEST".equals(user.getUserType());
        user.setCount((long) used)
                .setQuotaLimit(guest ? GUEST_QUOTA_LIMIT : null)
                .setQuotaRemaining(guest ? Math.max(0, GUEST_QUOTA_LIMIT - used) : null);
        return user;
    }

    /**
     * 判断用户是否有填写公司信息
     * @param userinfoId 用户ID
     * @return 0:没有，1有
     */
    public int getCompany(int userinfoId){
        DtoUserinfo user = getByUserId(userinfoId);
        if(null != user && null != user.getCompanyName() && !user.getCompanyName().trim().isEmpty()){
            return 1;
        }
        return 0;
    }

}
