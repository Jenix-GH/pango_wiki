// comps/top-menu.ts
Component({

    /**
     * 组件的属性列表
     */
    properties: {
        // 动态定义标题值
        title: {
            type: String,
            value: ''
        },
        iconName : {
            type: String,
            value: "gengduo"
        },
        activeTab: {
            type: String,
            value: 'chat'
        },
        showChatActions: {
            type: Boolean,
            value: false
        }
    },

    /**
     * 组件的初始数据
     */
    data: {
        statusBarHeight: 0,
        navigationBarHeight: 44
    },

    lifetimes: {
        attached() {
            const windowInfo = wx.getSystemInfoSync()
            const capsule = wx.getMenuButtonBoundingClientRect()
            const statusBarHeight = windowInfo.statusBarHeight || 0
            const navigationBarHeight = Math.max(
                40,
                (capsule.top - statusBarHeight) * 2 + capsule.height
            )
            this.setData({ statusBarHeight, navigationBarHeight })
        }
    },

    /**
     * 组件的方法列表
     */
    methods: {
        goto_left_menu(){
            this.triggerEvent('openLeftPanel')
        },
        reloadSession(){
            this.triggerEvent("reloadSession")
        },
        openWiki(){
            this.triggerEvent("openWiki")
        },
        openChat(){
            this.triggerEvent("openChat")
        },
        openLicense(){
            this.triggerEvent("openLicense")
        }
    }
})
