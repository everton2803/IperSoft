import time
import asyncio
import ipaddress
import logging
from typing import List, Optional, Dict, Any, Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine,
    CommunityData,
    UdpTransportTarget,
    ContextData,
    ObjectType,
    ObjectIdentity,
    get_cmd
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("IperScannerProbe")

app = FastAPI(
    title="IperSoft Network Scanner Probe",
    version="1.0.0",
    description="Microserviço autônomo para varredura de redes via ICMP e SNMP."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OID_SYSNAME = "1.3.6.1.2.1.1.5.0"
OID_SYSDESCR = "1.3.6.1.2.1.1.1.0"


class ScanRequest(BaseModel):
    cidr: str = Field(..., example="10.90.10.0/24", description="Sub-rede a ser varrida em formato CIDR.")
    communities: List[str] = Field(default=["ipermonitor", "public"], description="Lista de comunidades SNMP para tentar.")
    check_icmp: bool = Field(default=True, description="Se deve executar teste de ping ICMP.")
    timeout: float = Field(default=1.0, description="Timeout em segundos para ICMP e SNMP.")
    concurrency: int = Field(default=50, description="Número de tarefas simultâneas.")


class DiscoveredDevice(BaseModel):
    ip: str
    icmp_alive: bool
    snmp_alive: bool
    hostname: Optional[str] = None
    description: Optional[str] = None
    community: Optional[str] = None
    rtt_ms: Optional[float] = None
    status: str  # "snmp_and_icmp", "icmp_only", "inactive"


class ScanResponse(BaseModel):
    cidr: str
    total_scanned: int
    total_active: int
    duration_seconds: float
    devices: List[DiscoveredDevice]


async def ping_ip(ip: str, timeout: float = 1.0) -> Tuple[bool, Optional[float]]:
    """Executa um ping ICMP rápido assíncrono."""
    timeout_sec = max(1, int(timeout))
    start = time.time()
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", str(timeout_sec), ip,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL
        )
        ret = await proc.wait()
        elapsed_ms = round((time.time() - start) * 1000, 2)
        return (ret == 0, elapsed_ms if ret == 0 else None)
    except Exception:
        return (False, None)


async def snmp_query(engine: SnmpEngine, ip: str, communities: List[str], timeout: float = 1.0) -> Tuple[bool, Optional[str], Optional[str], Optional[str]]:
    """Tenta consultar o hostname e descrição via SNMP testando as comunidades configuradas."""
    try:
        target = await UdpTransportTarget.create((ip, 161), timeout=timeout, retries=0)
    except Exception:
        return (False, None, None, None)

    for comm in communities:
        try:
            errInd, errStat, errIdx, varBinds = await get_cmd(
                engine,
                CommunityData(comm, mpModel=1),
                target,
                ContextData(),
                ObjectType(ObjectIdentity(OID_SYSNAME)),
                ObjectType(ObjectIdentity(OID_SYSDESCR))
            )
            if not errInd and not errStat and varBinds:
                hostname = varBinds[0][1].prettyPrint().strip()
                descr = varBinds[1][1].prettyPrint().split("\n")[0].strip()[:60] if len(varBinds) > 1 else ""
                if hostname:
                    return (True, hostname, descr, comm)
        except Exception:
            continue

    return (False, None, None, None)


async def scan_single_ip(engine: SnmpEngine, ip_str: str, req: ScanRequest, semaphore: asyncio.Semaphore) -> DiscoveredDevice:
    async with semaphore:
        icmp_alive = False
        rtt_ms = None

        if req.check_icmp:
            icmp_alive, rtt_ms = await ping_ip(ip_str, req.timeout)

        # Consulta SNMP
        snmp_alive, hostname, description, used_community = await snmp_query(
            engine, ip_str, req.communities, req.timeout
        )

        # Se respondeu SNMP mas não ICMP (ex: ping bloqueado por firewall), ainda é ativo!
        if snmp_alive and icmp_alive:
            status = "snmp_and_icmp"
        elif snmp_alive and not icmp_alive:
            status = "snmp_only"
        elif icmp_alive and not snmp_alive:
            status = "icmp_only"
        else:
            status = "inactive"

        return DiscoveredDevice(
            ip=ip_str,
            icmp_alive=icmp_alive,
            snmp_alive=snmp_alive,
            hostname=hostname,
            description=description,
            community=used_community,
            rtt_ms=rtt_ms,
            status=status
        )


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "IperScannerProbe", "timestamp": time.time()}


@app.post("/api/v1/scan", response_model=ScanResponse)
async def execute_scan(req: ScanRequest):
    try:
        net = ipaddress.IPv4Network(req.cidr, strict=False)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"CIDR inválido: {e}")

    hosts_list = list(net.hosts())
    if len(hosts_list) > 1024:
        raise HTTPException(status_code=400, detail="Por segurança, o limite máximo por varredura é de 1024 IPs (/22).")

    logger.info(f"Iniciando varredura em {req.cidr} ({len(hosts_list)} hosts)...")
    start_time = time.time()

    engine = SnmpEngine()
    semaphore = asyncio.Semaphore(req.concurrency)

    try:
        tasks = [scan_single_ip(engine, str(ip), req, semaphore) for ip in hosts_list]
        devices = await asyncio.gather(*tasks)
    finally:
        engine.close_dispatcher()

    elapsed = round(time.time() - start_time, 2)
    # Filtra os que responderam algo
    active_devices = [d for d in devices if d.status != "inactive"]

    logger.info(f"Varredura em {req.cidr} concluída em {elapsed}s. {len(active_devices)} ativos de {len(hosts_list)}.")

    return ScanResponse(
        cidr=req.cidr,
        total_scanned=len(hosts_list),
        total_active=len(active_devices),
        duration_seconds=elapsed,
        devices=devices
    )
