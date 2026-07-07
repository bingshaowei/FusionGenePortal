import importlib.util
import os

app_path = os.path.join(os.path.dirname(__file__), "app.py")

spec = importlib.util.spec_from_file_location("fusiongp_app_file", app_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

application = module.app
