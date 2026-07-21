// index.ts
import { showSuccess, showError } from '../../utils/tools'
// 获取应用实例
const app = getApp()

interface User {
    nickName: string,
    avatarUrl: string,
    wxCode: string,
    count: number,
    flagCompanyInfo: boolean,
    todayQuestionList: [],
    weekQuestionList: []
}
interface Rs {
    code: Number,
    message: string,
    data: Object
}

interface ApiResponse<T> {
    code: number
    message: string
    data: T
}

interface questionList {
    todayQuestion: [],
    weekQuestion: []
}

Page({
    data: {
        title: "嗨！我是Pango慧答",
        mark: "我可以帮你FPGA芯片选型，应用智能问答，请把你的任务交给我吧 ~",
        flagUserInfo: false,
        flagUserPhone: false,
        userinfo: {} as User,
        showPrivacyDialog: false,
        code: '',
        //showProtocol: false, // 协议框
        answerCount: 0
    },
    //获取用户信息
    getUserInfo() {
        wx.showLoading({ title: "授权中...", mask: true })
        wx.getUserProfile({
            desc: '用于完善会员资料',
            success: (res) => {
                showSuccess("获取成功")
                // 打开获取手机号的按钮
                let user: User = JSON.parse(JSON.stringify(res.userInfo));
                this.setData({ flagUserInfo: true, userinfo: user })
                wx.setStorageSync('userImg', res.userInfo.avatarUrl);
                app.globalData.answerCount = user.count;
                app.globalData.todayQuestion = user.todayQuestionList;
                app.globalData.weekQuestion = user.weekQuestionList;
                app.globalData.flagCompanyInfo = user.flagCompanyInfo;
            },
            fail: (e: any) => {
                showError("获取失败:" + e);
            },
            complete: () => wx.hideLoading()
        });
    },
    // 点击获取手机号按钮
    onGetPhoneNumber(e: any) {
        if (!e.detail.code) {
            showError("授权获取微信号失败,请重新尝试")
            return
        }
        const code = e.detail.code;
        // 先显示隐私协议弹窗
        this.setData({ showPrivacyDialog: true, code: code });
    },
    // 打开隐私协议页面
    openPrivacyContract() {
        //调用子组件的方法
        const userProtocol = this.selectComponent('#userProtocol');
        userProtocol.showPanel();
    },
    // 用户拒绝隐私协议
    onPrivacyRefuse() {
        this.setData({ showPrivacyDialog: false });
        // 可以给用户一个提示
        wx.showToast({
            title: '需要同意才能继续',
            icon: 'none'
        });
    },
    // 用户同意隐私协议
    onPrivacyAgree() {
        this.setData({ showPrivacyDialog: false });
        // 用户同意后，调用获取手机号接口
        this.getPhoneNumber();
    },
    //获取手机号
    getPhoneNumber() {
        wx.showLoading({ title: "授权中...", mask: true })
        const code = this.data.code;
        const nickName = this.data.userinfo.nickName; //获取昵称，用于注册
        const imgUrl = this.data.userinfo.avatarUrl; //获取图像信息
        wx.request({
            url: app.globalData.baseHost + '/wx/getPhone',
            method: 'POST',
            data: { code: code, nickName: nickName },
            success: (res) => {
                let rs: Rs = JSON.parse(JSON.stringify(res.data));
                if (res.errMsg === "request:ok" && rs.code === 2000) {
                    const user: User = JSON.parse(JSON.stringify(rs.data));
                    if (null === user || user.wxCode === "") {
                        showError("获取微信号失败")
                        return;
                    }
                    user.avatarUrl = imgUrl;
                    // 本地持久化
                    wx.setStorageSync('userInfo', user);
                    this.setData({ flagUserPhone: true });
                    
                } else {
                    showError("获取失败-2")
                    wx.setStorageSync("userInfo", null)
                    this.setData({ flagUserInfo: false });
                }
            },
            fail: (res) => {
                showError("获取失败-1")
                console.log(JSON.stringify(res))
                wx.setStorageSync("userInfo", null)
                this.setData({ flagUserInfo: false });
            },
            complete: () => wx.hideLoading()
        });
    },
    gotoMain() {
        wx.navigateTo({
            url: "../main/main"
        })
    },
    //页面加载时检查是否已有用户信息
    onLoad() {
        //判断用户信息是否获得
        // let info = wx.getStorageSync("userInfo")
        // if (null == info || null == info.setId || info.setId <= 0) {
        //     this.setData({
        //         flagUserInfo: false,
        //         flagUserPhone: false
        //     });
        // } else {
        //     this.setData({
        //         flagUserInfo: true,
        //         flagUserPhone: true
        //     });
        // }
    },
})
