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
        }
    },

    /**
     * 组件的初始数据
     */
    data: {

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
        }
    }
})
