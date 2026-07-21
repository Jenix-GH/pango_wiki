// components/set-menu/set-menu.ts
Component({

    /**
     * 组件的属性列表
     */
    properties: {
        flagShowBackBtn: {
            type: Boolean,
            value: false
        }
    },

    /**
     * 组件的初始数据
     */
    data: {
        showPopup: false,                   //底部菜单显示控制
        showSubPage: "set",                 //底部菜单当前显示的页面名称
        title: '设置',                      //底部菜单的标题
        flagDataManagerUse: true            //个人数据授权存储及使用
    },

    /**
     * 组件的方法列表
     */
    methods: {
        showSetPanel() {
            this.setData({ showPopup: true })
        },
        hideSetPanel() {
            this.setData({ showPopup: false, showSubPage: "set", flagShowBackBtn: false, title: "设置" })
        },
        gotoSetList(){
            this.setData({showSubPage: "set", flagShowBackBtn: false, title: "设置"})
        },
        gotoUserinfo(){
            this.setData({showSubPage: "userinfo", flagShowBackBtn: true, title: "个人信息"})
        },
        gotoDataManager(){
            this.setData({showSubPage: "dataManager", flagShowBackBtn: true, title: "数据管理"})
        },
        gotoCompany(){
            this.setData({showSubPage: "company", flagShowBackBtn: true, title: "紫光同创"})
        },
        gotoContactUs(){
            this.setData({showSubPage: "contactUs", flagShowBackBtn: true, title: "联系我们"})
        },
        // 清除历史对话记录
        delHisData(){
            //TODO 向上触发让left-menu中的dataHisTitle清空
            this.triggerEvent('delHisData')
        }
    }
})