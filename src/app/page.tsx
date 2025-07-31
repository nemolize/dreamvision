import { FluidCanvas } from "@/components/fluid-canvas";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h1 className="mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-5xl font-bold text-transparent">
            2D Fluid Simulation
          </h1>
          <p className="mx-auto max-w-2xl text-xl text-gray-600">
            Interactive fluid dynamics simulation using the Navier-Stokes
            equations
          </p>
        </div>

        <div className="rounded-xl bg-white p-8 text-lg shadow-lg">
          <h2 className="mb-6 text-center text-3xl font-bold text-gray-800">
            Fluid Simulation
          </h2>
          <FluidCanvas width={120} height={80} scale={6} />
        </div>
      </div>
    </main>
  );
}
