// components/set-data-manager/set-data-manager.ts
let canChange = true;
let canDelete = true;
const app = getApp();
import { showError, showSuccess } from "../../utils/tools";

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
        flagDataUse: true,
        dataUseFlag: 1,
        userinfoId: -1,
        id: -1
    },

    /**
     * 组件的方法列表
     */
    methods: {
        //关闭对话使用权限
        changeDataUseFlag(e: any) {
            const value = (e.detail.value)?1:0;
            const id = this.data.id;
            //关闭设置
            if (!canChange) return;
            canChange = false;
            wx.showLoading({ title: '设置中...', mask: true })
            wx.request({
                url: app.globalData.baseHost + '/set/upFlagUseData',
                method: 'POST',
                data: { id: id, flagUseData:value },
                header: { 'Content-Type': 'application/json' },
                success(res) {
                    if (res.data.code === 2000) {
                        showSuccess("操作完成")
                        let user = wx.getStorageSync('userInfo');
                        user.flagUseData = value;
                        wx.setStorageSync('userInfo', user);
                    } else {
                        showError("设置失败-2")
                    }
                },
                fail(e: any) {
                    console.log(e)
                    showError("设置失败-1")
                },
                complete() {
                    setTimeout(() => canChange = true, 2000);
                    wx.hideLoading()
                }
            });
        },
        //删除历史数据
        delHisData() {
            //TODO 删除历史对话记录
            wx.showLoading({title:"删除中...",mask: true})
            wx.request({
                url: app.globalData.baseHost + '/question/doDelHis',
                method: 'POST',
                data: { userinfoId: this.data.userinfoId },
                success: () => {
                    wx.hideLoading()
                    // 清除小程序存储
                    wx.setStorageSync("userInfo", null)
                    console.log("删除完成")
                }
            });
            //TODO 向上触发让left-menu中的dataHisTitle清空
            this.triggerEvent('delHisData')
        }
    },
    attached() {
        //填充信息
        let user = wx.getStorageSync("userInfo")
        if (null != user && "" != user) {
            this.setData({
                flagDataUse: (user.flagUseData===1?true:false),
                dataUseFlag: user.flagUseData,
                userinfoId: user.id,
                id: user.setId
            })
        }
    }
})