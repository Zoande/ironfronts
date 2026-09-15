export class MeshBuilder {
  vertices: number[] = [];
  indices: number[] = [];

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, sideMaterial: number, topMaterial = sideMaterial): void {
    const faces: Array<[number[], number[], number]> = [
      [[minX,minY,maxZ, maxX,minY,maxZ, maxX,maxY,maxZ, minX,maxY,maxZ], [0,0,1], sideMaterial],
      [[maxX,minY,minZ, minX,minY,minZ, minX,maxY,minZ, maxX,maxY,minZ], [0,0,-1], sideMaterial],
      [[maxX,minY,maxZ, maxX,minY,minZ, maxX,maxY,minZ, maxX,maxY,maxZ], [1,0,0], sideMaterial],
      [[minX,minY,minZ, minX,minY,maxZ, minX,maxY,maxZ, minX,maxY,minZ], [-1,0,0], sideMaterial],
      [[minX,maxY,maxZ, maxX,maxY,maxZ, maxX,maxY,minZ, minX,maxY,minZ], [0,1,0], topMaterial],
      [[minX,minY,minZ, maxX,minY,minZ, maxX,minY,maxZ, minX,minY,maxZ], [0,-1,0], sideMaterial],
    ];
    for (const [positions, normal, material] of faces) {
      const start = this.vertices.length / 7;
      for (let vertex = 0; vertex < 4; vertex += 1) {
        this.vertices.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2], normal[0], normal[1], normal[2], material);
      }
      this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }

  addCone(x: number, baseY: number, z: number, radius: number, tipY: number, sides: number, material: number): void {
    const tipStart = this.vertices.length / 7;
    for (let side = 0; side < sides; side += 1) {
      const angleA = side / sides * Math.PI * 2;
      const angleB = (side + 1) / sides * Math.PI * 2;
      const mid = (angleA + angleB) * 0.5;
      const normal = [Math.sin(mid) * 0.86, 0.5, Math.cos(mid) * 0.86];
      const start = this.vertices.length / 7;
      this.vertices.push(x, tipY, z, ...normal, material);
      this.vertices.push(x + Math.sin(angleA) * radius, baseY, z + Math.cos(angleA) * radius, ...normal, material);
      this.vertices.push(x + Math.sin(angleB) * radius, baseY, z + Math.cos(angleB) * radius, ...normal, material);
      this.indices.push(start, start + 1, start + 2);
    }
    void tipStart;
  }

  addFacetedSphere(material: number): void {
    const top = [0, 1, 0], bottom = [0, -1, 0];
    const east = [1, 0, 0], west = [-1, 0, 0], north = [0, 0, -1], south = [0, 0, 1];
    const faces = [
      [top, south, east], [top, east, north], [top, north, west], [top, west, south],
      [bottom, east, south], [bottom, south, west], [bottom, west, north], [bottom, north, east],
    ];
    for (const face of faces) {
      const edgeA = face[1].map((value, axis) => value - face[0][axis]);
      const edgeB = face[2].map((value, axis) => value - face[0][axis]);
      const normal = [
        edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
        edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
        edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
      ];
      const length = Math.hypot(...normal);
      const start = this.vertices.length / 7;
      for (const position of face) this.vertices.push(...position, normal[0] / length, normal[1] / length, normal[2] / length, material);
      this.indices.push(start, start + 1, start + 2);
    }
  }

  addGableRoof(minX: number, baseY: number, minZ: number, maxX: number, ridgeY: number, maxZ: number, material: number): void {
    const halfWidth = Math.max(0.001, (maxX - minX) * 0.5);
    const rise = ridgeY - baseY;
    const slopeLength = Math.hypot(halfWidth, rise);
    const faces: Array<[number[], number[]]> = [
      [[minX,baseY,minZ, minX,baseY,maxZ, 0,ridgeY,maxZ, 0,ridgeY,minZ], [-rise / slopeLength, halfWidth / slopeLength, 0]],
      [[maxX,baseY,maxZ, maxX,baseY,minZ, 0,ridgeY,minZ, 0,ridgeY,maxZ], [rise / slopeLength, halfWidth / slopeLength, 0]],
    ];
    for (const [positions, normal] of faces) {
      const start = this.vertices.length / 7;
      for (let vertex = 0; vertex < 4; vertex += 1) this.vertices.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2], ...normal, material);
      this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    for (const [positions, normal] of [
      [[minX,baseY,minZ, maxX,baseY,minZ, 0,ridgeY,minZ], [0,0,-1]],
      [[maxX,baseY,maxZ, minX,baseY,maxZ, 0,ridgeY,maxZ], [0,0,1]],
    ] as Array<[number[], number[]]>) {
      const start = this.vertices.length / 7;
      for (let vertex = 0; vertex < 3; vertex += 1) this.vertices.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2], ...normal, material);
      this.indices.push(start, start + 1, start + 2);
    }
  }

  addHipRoof(x: number, baseY: number, z: number, radius: number, tipY: number, material: number): void {
    const corners = [[-radius,-radius], [radius,-radius], [radius,radius], [-radius,radius]];
    for (let side = 0; side < 4; side += 1) {
      const a = corners[side];
      const b = corners[(side + 1) % 4];
      const midX = (a[0] + b[0]) * 0.5;
      const midZ = (a[1] + b[1]) * 0.5;
      const length = Math.max(0.001, Math.hypot(midX, tipY - baseY, midZ));
      const normal = [-midX / length, radius / length, -midZ / length];
      const start = this.vertices.length / 7;
      this.vertices.push(
        x + a[0], baseY, z + a[1], ...normal, material,
        x + b[0], baseY, z + b[1], ...normal, material,
        x, tipY, z, ...normal, material,
      );
      this.indices.push(start, start + 2, start + 1);
    }
  }

  addPlane(material: number): void {
    const start = this.vertices.length / 7;
    this.vertices.push(
      -1, 0, -1, 0, 1, 0, material,
      -1, 0, 1, 0, 1, 0, material,
      1, 0, -1, 0, 1, 0, material,
      1, 0, 1, 0, 1, 0, material,
    );
    this.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  }
}
