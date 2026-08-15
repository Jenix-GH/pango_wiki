import { showError, showSuccess, persistUserInfo } from "../../utils/tools";

// components/set-userinfo/set-userinfo.ts
const app = getApp();
let canSubmit = true;
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
        nickName: "",
        wxCode: "",
        mailAddress: "",
        companyName: "",
        jobName: "",
        id: -1
    },

    /**
     * 组件的方法列表
     */
    methods: {
        doSave() {
            if(!canSubmit) return;
            canSubmit = false;
            wx.showLoading({ title: '保存中...', mask: true })
            wx.request({
                url: app.globalData.baseHost + '/userinfo/doUpdate',
                method: 'POST',
                data: this.data,
                header: { 'Content-Type': 'application/json' },
                success(res) {
                    if (res.data.code === 2000) {
                        showSuccess("操作完成");
                        if(res.data.data.companyName != ''){
                            app.globalData.flagCompanyInfo = true;
                        }else{
                            app.globalData.flagCompanyInfo = false;
                        }
                        persistUserInfo(res.data.data);
                    }else{
                        showError("保存失败-2")
                    }
                },
                fail(e : any) {
                    console.log(e)
                    showError("保存失败-1")
                },
                complete() {
                    setTimeout(() => canSubmit = true, 2000);
                    wx.hideLoading()
                }
            });
        }
    },
    lifetimes: {
        attached() {
            //填充信息
            let user = wx.getStorageSync("userInfo")
            if (null != user && "" != user) {
                this.setData({
                    nickName: user.nickName,
                    wxCode: user.wxCode,
                    mailAddress: user.mailAddress,
                    companyName: user.companyName,
                    jobName: user.jobName,
                    id: user.id
                })
            }
        }
    }
})
