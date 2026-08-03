package com.pango.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.pango.entity.DtoLicenseApplication;
import com.pango.mapper.MapperLicenseApplication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;

@Service
@Transactional
public class ServiceLicenseApplication extends ServiceImpl<MapperLicenseApplication, DtoLicenseApplication> {
    public DtoLicenseApplication submit(DtoLicenseApplication application) {
        Date now = new Date();
        application.setId(null)
                .setStatus(0)
                .setDotime(now)
                .setUptime(now);
        save(application);
        return new DtoLicenseApplication().setId(application.getId()).setStatus(application.getStatus());
    }
}
