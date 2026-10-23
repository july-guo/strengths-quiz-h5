#!/usr/bin/env python3
"""构建脚本：把 JS/CSS 内联进模板，产出可直接发布的单文件 HTML。
平台代理要求所有请求带 sharecode，子资源会被 403，因此页面必须零子资源依赖。
用法：python3 build.py  （每次修改 *.js / style.css / *.template.html 后运行）"""
import re

def build(template_path, out_path, css_files, js_files):
    html = open(template_path).read()
    for css in css_files:
        body = open(css).read()
        new_block = "<style>\n" + body + "</style>"
        if "<style>" in html:
            html = re.sub(r"<style>.*?</style>", lambda m: new_block, html, count=1, flags=re.S)
        else:
            tag = '<link rel="stylesheet" href="%s">' % css
            assert tag in html, tag + " 不在模板中"
            html = html.replace(tag, new_block)
    for js in js_files:
        tag = '<script src="%s"></script>' % js
        assert tag in html, tag + " 不在模板中"
        body = open(js).read()
        assert "</script>" not in body.lower(), js + " 含 </script>"
        html = html.replace(tag, "<script>\n" + body + "\n</script>")
    open(out_path, "w").write(html)
    print(out_path, "->", len(html), "bytes")

build("index.template.html", "index.html", ["style.css"], ["sdk.js", "qrcode.js", "app.data.js", "cloud.js", "app.js"])
build("admin.template.html", "admin.html", [], ["sdk.js", "app.data.js"])
print("构建完成")
