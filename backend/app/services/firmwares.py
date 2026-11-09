import os
import re
import time
import httpx
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

def format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    elif size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    else:
        return f"{size / (1024 * 1024 * 1024):.2f} GB"

class FirmwaresService:
    def __init__(
        self,
        base_dir: str = "/firmwares",
        fallback_dir: str = "/opt/firmwares/data",
        http_url: str = "http://10.10.1.2:8089",
        internal_http_url: str = "http://firmwares_http",
        web_url: str = "https://firmware.iper.net.br"
    ):
        self.base_dir = base_dir if os.path.exists(base_dir) else fallback_dir
        self.http_url = http_url.rstrip("/")
        self.internal_http_url = internal_http_url.rstrip("/")
        self.web_url = web_url.rstrip("/")

    def get_effective_dir(self) -> Optional[str]:
        if os.path.exists(self.base_dir):
            return self.base_dir
        if os.path.exists("/firmwares"):
            return "/firmwares"
        if os.path.exists("/opt/firmwares/data"):
            return "/opt/firmwares/data"
        return None

    def scan_local_disk(self, directory: str, base_download_url: str) -> List[Dict[str, Any]]:
        results = []
        for root, dirs, files in os.walk(directory):
            for f in files:
                # Ignora arquivos ocultos ou temporários
                if f.startswith("."):
                    continue
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, directory).replace("\\", "/")
                folder = os.path.dirname(rel_path) or "raiz"
                try:
                    stat = os.stat(full_path)
                    size = stat.st_size
                    mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                except Exception:
                    size = 0
                    mtime = None

                results.append({
                    "filename": f,
                    "folder": folder,
                    "relative_path": rel_path,
                    "size_bytes": size,
                    "size_formatted": format_bytes(size),
                    "modified_at": mtime,
                    "download_url": f"{base_download_url}/{rel_path}"
                })
        return sorted(results, key=lambda x: (x["folder"], x["filename"]))

    async def scan_http_autoindex(self, target_http_url: str, base_download_url: str) -> List[Dict[str, Any]]:
        results = []
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.get(f"{target_http_url}/")
                if res.status_code != 200:
                    return results

                # Parsing simples de Nginx autoindex
                # Procura links <a href="subdir/"> ou <a href="file.ext">
                lines = res.text.splitlines()
                subdirs = []
                for line in lines:
                    match_dir = re.search(r'<a href="([^"/]+)/">', line)
                    if match_dir and match_dir.group(1) != "..":
                        subdirs.append(match_dir.group(1))

                    match_file = re.search(r'<a href="([^"/]+)">([^<]+)</a>\s+([0-9A-Za-z-]+\s+[0-9:]+)\s+([0-9-]+)', line)
                    if match_file:
                        fname = match_file.group(1)
                        sz_str = match_file.group(4)
                        try:
                            sz = int(sz_str)
                        except ValueError:
                            sz = 0
                        results.append({
                            "filename": fname,
                            "folder": "raiz",
                            "relative_path": fname,
                            "size_bytes": sz,
                            "size_formatted": format_bytes(sz),
                            "modified_at": None,
                            "download_url": f"{base_download_url}/{fname}"
                        })

                # Varre subpastas detectadas (ex: datacom/)
                for sdir in subdirs:
                    try:
                        res_sub = await client.get(f"{target_http_url}/{sdir}/")
                        if res_sub.status_code == 200:
                            for sline in res_sub.text.splitlines():
                                match_f = re.search(r'<a href="([^"/]+)">([^<]+)</a>\s+([0-9A-Za-z-]+\s+[0-9:]+)\s+([0-9-]+)', sline)
                                if match_f and match_f.group(1) != "..":
                                    fname = match_f.group(1)
                                    rel = f"{sdir}/{fname}"
                                    sz_str = match_f.group(4)
                                    try:
                                        sz = int(sz_str)
                                    except ValueError:
                                        sz = 0
                                    results.append({
                                        "filename": fname,
                                        "folder": sdir,
                                        "relative_path": rel,
                                        "size_bytes": sz,
                                        "size_formatted": format_bytes(sz),
                                        "modified_at": None,
                                        "download_url": f"{base_download_url}/{rel}"
                                    })
                    except Exception:
                        pass
        except Exception:
            pass

        return sorted(results, key=lambda x: (x["folder"], x["filename"]))

    async def list_firmwares(self, download_base: Optional[str] = None) -> Dict[str, Any]:
        base_dl = (download_base or self.http_url).rstrip("/")
        eff_dir = self.get_effective_dir()
        
        files = []
        source = "disk"
        if eff_dir and os.path.exists(eff_dir):
            files = self.scan_local_disk(eff_dir, base_dl)
        else:
            source = "http"
            # Tenta via internal_http_url (container) ou fallback para http_url
            files = await self.scan_http_autoindex(self.internal_http_url, base_dl)
            if not files:
                files = await self.scan_http_autoindex(self.http_url, base_dl)

        total_bytes = sum(f.get("size_bytes", 0) for f in files)
        folders = sorted(list(set(f["folder"] for f in files)))

        return {
            "source": source,
            "directory": eff_dir or self.internal_http_url,
            "total_files": len(files),
            "total_size_bytes": total_bytes,
            "total_size_formatted": format_bytes(total_bytes),
            "folders": folders,
            "files": files,
            "http_base_url": base_dl,
            "web_url": self.web_url
        }

    async def test_connectivity(self, test_http_url: Optional[str] = None, test_web_url: Optional[str] = None) -> Dict[str, Any]:
        h_url = (test_http_url or self.http_url).rstrip("/")
        w_url = (test_web_url or self.web_url).rstrip("/")
        
        http_status = {"online": False, "latency_ms": None, "url": h_url, "error": None}
        web_status = {"online": False, "latency_ms": None, "url": w_url, "error": None}

        # Testa endpoint HTTP (download)
        # Tenta primeiro a URL configurada, com fallback para container interno se falhar
        urls_to_try = [h_url]
        if self.internal_http_url not in urls_to_try:
            urls_to_try.append(self.internal_http_url)

        async with httpx.AsyncClient(timeout=3.5, verify=False) as client:
            for url in urls_to_try:
                t0 = time.time()
                try:
                    res = await client.get(f"{url}/")
                    if res.status_code in [200, 301, 302]:
                        http_status["online"] = True
                        http_status["latency_ms"] = round((time.time() - t0) * 1000, 1)
                        http_status["url"] = url
                        http_status["status_code"] = res.status_code
                        break
                except Exception as e:
                    http_status["error"] = str(e)

            # Testa endpoint Web (FileBrowser)
            t0 = time.time()
            try:
                res_w = await client.get(w_url)
                if res_w.status_code in [200, 301, 302, 404]:
                    web_status["online"] = True
                    web_status["latency_ms"] = round((time.time() - t0) * 1000, 1)
                    web_status["status_code"] = res_w.status_code
            except Exception as e:
                web_status["error"] = str(e)

        return {
            "is_connected": http_status["online"] or web_status["online"],
            "http_service": http_status,
            "web_service": web_status,
            "tested_at": datetime.now(timezone.utc).isoformat()
        }

    @staticmethod
    def generate_commands(
        relative_path: str,
        filename: str,
        http_base_url: str,
        os_profile: Optional[str] = None,
        backup_model: Optional[str] = None
    ) -> Dict[str, Any]:
        dl_url = f"{http_base_url.rstrip('/')}/{relative_path.lstrip('/')}"
        clean_fn = filename
        
        # Detecta perfil
        profile = (os_profile or "").lower()
        model = (backup_model or "").lower()
        ext = os.path.splitext(filename)[1].lower()

        commands = []

        # 1. Datacom DmOS
        if "datacom" in profile or "dmos" in profile or "datacom" in model or ext in [".swu", ".img"]:
            commands.append({
                "label": "Datacom DmOS — Upgrade de Sistema (Direto)",
                "description": "Faz o download do pacote .swu/.img e executa o processo de instalação do DmOS.",
                "command": f"request system software-upgrade url {dl_url}"
            })
            commands.append({
                "label": "Datacom DmOS — Copiar para Flash",
                "description": "Apenas transfere o arquivo para a memória Flash do equipamento.",
                "command": f"copy {dl_url} flash:{clean_fn}"
            })

        # 2. Datacom DmSwitch / Legado
        if "dmswitch" in profile or "datacom" in profile or ext in [".bin", ".rom"]:
            commands.append({
                "label": "Datacom DmSwitch — Copiar Firmware para Flash",
                "description": "Download direto via HTTP para switches gerenciáveis DM4000/DM4100/DM1200.",
                "command": f"copy {dl_url} flash:{clean_fn}"
            })

        # 3. MikroTik RouterOS
        if "mikrotik" in profile or "routeros" in model or ext in [".npk", ".rsc"]:
            commands.append({
                "label": "MikroTik RouterOS — Download via /tool fetch",
                "description": "Baixa o pacote .npk direto para a raiz do RouterOS para atualização no reboot.",
                "command": f'/tool fetch url="{dl_url}" mode=http dst-path="{clean_fn}"'
            })

        # 4. Cisco IOS
        if "cisco" in profile or "ios" in model or ext in [".bin", ".tar"]:
            commands.append({
                "label": "Cisco IOS — Copiar para Flash",
                "description": "Download HTTP nativo para switches e roteadores Cisco Catalyst / ISR.",
                "command": f"copy {dl_url} flash:{clean_fn}"
            })

        # 5. Linux / Genérico
        commands.append({
            "label": "Download Genérico (curl / wget)",
            "description": "Comando universal para download em servidores Linux ou estações.",
            "command": f"curl -O {dl_url}"
        })

        return {
            "filename": filename,
            "relative_path": relative_path,
            "download_url": dl_url,
            "commands": commands
        }
