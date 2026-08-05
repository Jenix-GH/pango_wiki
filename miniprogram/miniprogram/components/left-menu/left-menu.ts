// components/left-menu/left-menu.ts
import { copyToClipboard, showSuccess, showError } from '../../utils/tools'
const app = getApp()

interface User {
    nickName: string,
    avatarUrl: string,
    wxCode: string,
    count: number,
    flagCompanyInfo: boolean,
    todayQuestionList: [],
    weekQuestionList: [],
    accessToken?: string
}
interface Rs {
    code: Number,
    message: string,
    data: Object
}

Component({

    /**
     * 组件的属性列表
     */
    properties: {
        //历史对话标题
        dataHisTitle: {
            type: Array,
            value: []
        },
        dataDayTitle: {
            type: Array,
            value: []
        }
    },

    /**
     * 组件的初始数据
     */
    data: {
        flag_showLeftPanel: false,
        maskAnimation: null as any,         //左侧面板遮罩层动画
        panelAnimation: null as any,        //左侧面板动画
        activeId: -1 as number,              //选中的历史记录ID
        activeId0: -1 as number,
        avatarUrl: '',
        nickName: '',
        showPrivacyDialog: false,
        flagUserInfo: false,
        flagUserPhone: false,
        userinfo: {} as User,
        code: '',
        flagLogin: false
    },
    /**
     * 组件的方法列表
     */
    methods: {
        //打开左侧面板
        showLeftPanel() {
            const maskAnim = wx.createAnimation({
                duration: 300,
                timingFunction: 'ease'
            })
            const panelAnim = wx.createAnimation({
                duration: 400,
                timingFunction: 'ease'
            })
            maskAnim.opacity(1).step()
            panelAnim.left('0').step()
            this.setData({
                flag_showLeftPanel: true,
                maskAnimation: maskAnim.export(),
                panelAnimation: panelAnim.export()
            })
        },
        //关闭左侧面板
        hideLeftPanel() {
            const maskAnim = wx.createAnimation({
                duration: 200,
                timingFunction: 'ease'
            })
            const panelAnim = wx.createAnimation({
                duration: 300,
                timingFunction: 'ease'
            })
            maskAnim.opacity(0).step()
            panelAnim.left('-75%').step()
            this.setData({
                maskAnimation: maskAnim.export(),
                panelAnimation: panelAnim.export()
            })
            setTimeout(() => {
                this.setData({ flag_showLeftPanel: false })
            }, 300)
        },
        //‌阻止默认行为,侧边抽屉展开时固定主内容区位置‌
        preventTouchMove() {
            return false
        },
        // 复制历史对话标题
        doCopy(e: any) { //复制内容
            const { content, id } = e.currentTarget.dataset
            this.setData({ activeId: id, activeId0: -1 })
            wx.showActionSheet({
                itemList: ["复制内容"],
                success: (res) => {
                    if (res.tapIndex === 0) {
                        copyToClipboard(content);
                    }
                }
            });
        },
        doClearChoose() {
            this.setData({ activeId: -1, activeId0: -1 })
        },
        // 复制历史对话标题
        doCopy0(e: any) { //复制内容
            const { content, id } = e.currentTarget.dataset
            this.setData({ activeId0: id, activeId: -1 })
            wx.showActionSheet({
                itemList: ["复制内容"],
                success: (res) => {
                    if (res.tapIndex === 0) {
                        copyToClipboard(content);
                    }
                }
            });
        },
        // 打开设置页面
        goto_set_page() {
            this.triggerEvent('openSetPanel')
        },
        //根据ID查询历史回答记录
        doSearchHis(e: any) {
            const { id, sessionId } = e.currentTarget.dataset
            this.setData({ activeId: id, activeId0: -1 })
            this.triggerEvent('doSearchHisItem', { sessionId })
        },
        //获取用户信息
        getUserInfo() {
            wx.showLoading({ title: "授权中...", mask: true })
            wx.getUserProfile({
                desc: '用于完善会员资料',
                success: (res) => {
                    showSuccess("获取成功")
                    // // 打开获取手机号的按钮
                    let user: User = JSON.parse(JSON.stringify(res.userInfo));
                    console.log(user)
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
                        if (user.accessToken) {
                            wx.setStorageSync('pangoAccessToken', user.accessToken)
                        }
                        // 本地持久化
                        wx.setStorageSync('userInfo', user);
                        this.setData({ flagUserPhone: true, avatarUrl: user.avatarUrl, nickName: user.nickName,flagLogin: true });
                        app.globalData.flagLogin = true;
                        //重新加载父页面的onload
                        this.triggerEvent('refresh') // 触发自定义事件
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
    },
    lifetimes: {
        attached() {
            //判断用户信息是否获得
            let info = wx.getStorageSync("userInfo")
            if (null == info || null == info.setId || info.setId <= 0) {
                this.setData({
                    flagUserInfo: false,
                    flagUserPhone: false,
                    flagLogin: false
                });
                app.globalData.flagLogin = false
            } else {
                this.setData({
                    flagUserInfo: true,
                    flagUserPhone: true,
                    flagLogin: true
                });
                app.globalData.flagLogin = true
            }
            this.setData({ avatarUrl: info.avatarUrl, nickName: info.nickName })
        }
    }
})
