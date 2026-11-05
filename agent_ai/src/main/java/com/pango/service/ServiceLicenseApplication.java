package com.pango.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pango.entity.DtoLicenseApplication;
import com.pango.exception.MyException;
import com.pango.mapper.MapperLicenseApplication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Calendar;
import java.util.Date;

@Service
@Transactional
public class ServiceLicenseApplication extends ServiceImpl<MapperLicenseApplication, DtoLicenseApplication> {
    public DtoLicenseApplication submit(DtoLicenseApplication application) {
        Date now = new Date();
        Calendar threeYearsAgo = Calendar.getInstance();
        threeYearsAgo.setTime(now);
        threeYearsAgo.add(Calendar.YEAR, -3);
        long approvedApplications = lambdaQuery()
                .eq(DtoLicenseApplication::getMacAddress, application.getMacAddress())
                .eq(DtoLicenseApplication::getStatus, 2)
                .ge(DtoLicenseApplication::getUptime, threeYearsAgo.getTime())
                .count();
        if (approvedApplications > 0) {
            throw new MyException("该MAC地址在最近三年内已有通过的申请，不能重复提交");
        }
        application.setId(null)
                .setStatus(0)
                .setDotime(now)
                .setUptime(now);
        save(application);
        return new DtoLicenseApplication().setId(application.getId()).setStatus(application.getStatus());
    }
}
