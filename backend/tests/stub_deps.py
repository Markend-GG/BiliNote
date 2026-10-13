"""本地无 Docker 跑后端测试用的重依赖 stub 安装器。

容器镜像里 yt_dlp/chromadb/openai/... 都齐，install_missing_stubs() 第一次 import app
就成功、什么都不做；本地宿主缺哪个才 stub 哪个（只 stub find 不到的模块，不 shadow 真包）。
stub 类支持迭代/下标/任意属性，够撑过下载器与向量库的 import 期代码。
"""

import importlib
import sys
import types


class _StubMeta(type):
    def __iter__(cls):
        return iter(())

    def __getitem__(cls, _k):
        return _Stub

    def __getattr__(cls, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return _Stub


class _Stub(metaclass=_StubMeta):
    def __init__(self, *a, **k):
        pass

    def __call__(self, *a, **k):
        return _Stub()

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return _Stub()

    def __iter__(self):
        return iter(())

    def __getitem__(self, _k):
        return _Stub()


def install_missing_stubs(max_rounds: int = 80) -> list:
    stubbed = []
    for _ in range(max_rounds):
        try:
            importlib.import_module("app")
            return stubbed
        except ModuleNotFoundError as e:
            mod = types.ModuleType(e.name)
            mod.__getattr__ = lambda name: _Stub
            sys.modules[e.name] = mod
            stubbed.append(e.name)
    raise ImportError("stub 轮数用完，app 仍导入失败")
