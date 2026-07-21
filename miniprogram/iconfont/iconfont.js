Component({
  properties: {
    // gengduo | shoucang | youjiantou | tishi | AIchuangzuo | tianjia | shezhi | baogaocuowu | fanhui | xiala | fuzhi | tuichudenglu | gongnengqingqiu | fasongfankui | zuojiantou | bangzhufankui | x | shanchu | sousuo | zhuye | lianjie | bianji | yaoqinghaoyou | shuaxin | yishoucang | image | file-unknown | layers | mail | share | scan | service | sound | server | zhanghu-yonghuguanli | yanzhengma | mima | qukuailianwangluo | file | user | tongzhi | shenqingdaochujilu | attach | file1 | anquanyuguanli | shouye-01 | yonghuguanli-01 | Frame | dakai | shujuguanli | xiazai
    name: {
      type: String,
    },
    // string | string[]
    color: {
      type: null,
      observer: function(color) {
        this.setData({
          colors: this.fixColor(),
          isStr: typeof color === 'string',
        });
      }
    },
    size: {
      type: Number,
      value: 18,
      observer: function(size) {
        this.setData({
          svgSize: size,
        });
      },
    },
  },
  data: {
    colors: '',
    svgSize: 18,
    quot: '"',
    isStr: true,
  },
  methods: {
    fixColor: function() {
      var color = this.data.color;
      var hex2rgb = this.hex2rgb;

      if (typeof color === 'string') {
        return color.indexOf('#') === 0 ? hex2rgb(color) : color;
      }

      return color.map(function (item) {
        return item.indexOf('#') === 0 ? hex2rgb(item) : item;
      });
    },
    hex2rgb: function(hex) {
      var rgb = [];

      hex = hex.substr(1);

      if (hex.length === 3) {
        hex = hex.replace(/(.)/g, '$1$1');
      }

      hex.replace(/../g, function(color) {
        rgb.push(parseInt(color, 0x10));
        return color;
      });

      return 'rgb(' + rgb.join(',') + ')';
    }
  }
});
