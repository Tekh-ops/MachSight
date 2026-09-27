import asyncio, websockets, json
async def send():
    async with websockets.connect('ws://localhost:8000/telemetry/ingest') as ws:
        await ws.send(json.dumps({'car_id':'car-01','distance_cm':85.0,'current_a':1.75,'rpm':305.0,'pwm_command':200,'mode':'forward'}))
        await asyncio.sleep(0.5)
asyncio.run(send())
