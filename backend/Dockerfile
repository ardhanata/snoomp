FROM python:3.11-slim

WORKDIR /workspace

# Install system dependencies (build-essential for compiling pycrypto/paramiko/asyncssh wheels, iputils-ping for ICMP ping)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libssl-dev \
    iputils-ping \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
