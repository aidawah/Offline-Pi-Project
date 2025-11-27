#!/usr/bin/env python3
import json
import sys

try:
    import adafruit_dht  # type: ignore
    import board  # type: ignore
except ImportError as exc:
    print(json.dumps({"error": f"missing adafruit_dht: {exc}"}))
    sys.exit(1)

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: read_dht.py <type> <bcm_pin>"}))
        return

    try:
        dht_type = int(sys.argv[1])
        bcm_pin = int(sys.argv[2])
    except ValueError:
        print(json.dumps({"error": "invalid args"}))
        return

    # Map BCM pin to board pin; use libgpiod backend via board.GPIOn
    try:
        pin = getattr(board, f"D{bcm_pin}")
    except AttributeError:
        print(json.dumps({"error": f"Unsupported pin D{bcm_pin}"}))
        return

    try:
        if dht_type == 22:
            sensor = adafruit_dht.DHT22(pin, use_pulseio=False)
        else:
            sensor = adafruit_dht.DHT11(pin, use_pulseio=False)

        temperature_c = sensor.temperature
        humidity = sensor.humidity
        if temperature_c is None or humidity is None:
            raise RuntimeError("No data")
        print(json.dumps({
            "tempC": float(temperature_c),
            "tempF": float(temperature_c) * 1.8 + 32,
            "humidity": float(humidity),
        }))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
    finally:
        try:
            sensor.exit()
        except Exception:
            pass

if __name__ == "__main__":
    main()
