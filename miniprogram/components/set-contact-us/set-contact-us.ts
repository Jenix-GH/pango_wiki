// components/set-contact-us/set-contact-us.ts
Component({

    /**
     * 组件的属性列表
     */
    properties: {

    },

    /**
     * 组件的初始数据
     */
    data: {
        companyContactList: [
            { id: 1, title: "深圳总公司", tel: "86-755-66886188", fax: "86-755-86363368", code: "518000", mail: "marketing@pangomicro.com", address: "深圳市南山区高新技术产业园高新南一道15号" },
            { id: 2, title: "上海子公司", tel: "021-54652018", fax: "021-64856887", code: "200233", mail: "marketing@pangomicro.com", address: "上海市漕河泾开发区桂平路391号新漕河泾国际商务中心A座901-902室" },
            { id: 3, title: "成都子公司", tel: "028-86736086", fax: "", code: "610095", mail: "marketing@pangomicro.com", address: "成都高新区益州大道中段2555号紫光芯云中心B座25楼" },
            { id: 4, title: "北京分公司", tel: "010-50911622", fax: "", code: "100191", mail: "marketing@pangomicro.com", address: "北京市海淀区知春路7号致真大厦B座15层" }
        ]
    },

    /**
     * 组件的方法列表
     */
    methods: {

    }
})