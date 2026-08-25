import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Home, ArrowLeft, Ghost } from 'lucide-react';

const NotFound: React.FC = () => {
    const navigate = useNavigate();
    const [eggDiscovered, setEggDiscovered] = useState(false);

    return (
        <div className="relative min-h-screen bg-gray-50 flex items-center justify-center overflow-hidden font-sans p-4 z-0">

            {/* Subtle Grid Background */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" aria-hidden="true" />

            {/* Playful ambient background */}
            <div className="absolute top-1/4 left-1/4 w-[50vw] h-[50vw] max-w-[500px] max-h-[500px] bg-purple-400/20 rounded-full blur-[120px] pointer-events-none mix-blend-multiply" aria-hidden="true" />
            <div className="absolute bottom-1/4 right-1/4 w-[40vw] h-[40vw] max-w-[400px] max-h-[400px] bg-indigo-400/20 rounded-full blur-[100px] pointer-events-none mix-blend-multiply" aria-hidden="true" />

            <div className="relative z-10 max-w-2xl w-full text-center flex flex-col items-center">

                {/* Bouncing Ghost Icon with Interactive Hover */}
                <div className="mb-2 relative flex flex-col items-center justify-center group cursor-pointer">
                    <div className="animate-bounce relative z-10">
                        <div className="bg-white p-5 rounded-full shadow-xl shadow-purple-900/10 ring-4 ring-purple-100 group-hover:bg-purple-50 group-hover:ring-purple-200 transition-colors duration-300">
                            <Ghost className="w-12 h-12 text-purple-600 group-hover:rotate-12 transition-transform duration-300" strokeWidth={1.5} />
                        </div>
                    </div>
                    <div className="w-12 h-2 bg-purple-900/10 rounded-[100%] animate-pulse absolute -bottom-2 blur-[2px]" />
                </div>

                <h1 className="text-8xl sm:text-[10rem] font-black tracking-tighter drop-shadow-sm select-none text-transparent bg-clip-text bg-gradient-to-br from-gray-900 via-gray-800 to-gray-600 pb-4">
                    4<span className="text-transparent bg-clip-text bg-gradient-to-br from-purple-500 to-indigo-600 animate-pulse inline-block mx-1">0</span>4
                </h1>

                <div className="mt-2 space-y-4 max-w-lg mx-auto px-4">
                    <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 tracking-tight">
                        Oh no! There's nothing here.
                    </h2>
                    <p className="text-base sm:text-lg text-gray-500 font-medium leading-relaxed">
                        We looked behind the server racks and checked under the digital rug, but this page has completely vanished.
                    </p>
                </div>

                {/* Thematic Action Buttons */}
                <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto px-6">
                    <button
                        onClick={() => navigate(-1)}
                        className="group w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3.5 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-xl hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700 focus:outline-none focus:ring-4 focus:ring-purple-100 transition-all duration-200 cursor-pointer shadow-sm"
                    >
                        <ArrowLeft size={18} className="text-gray-400 group-hover:text-purple-600 group-hover:-translate-x-1 transition-all" />
                        Go Back
                    </button>

                    <Link
                        to="/admin"
                        className="group w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3.5 bg-purple-600 border-2 border-purple-600 text-white font-bold rounded-xl shadow-lg shadow-purple-600/20 hover:bg-purple-700 hover:border-purple-700 hover:-translate-y-1 focus:outline-none focus:ring-4 focus:ring-purple-200 transition-all duration-200 cursor-pointer"
                    >
                        <Home size={18} className="group-hover:scale-110 transition-transform" />
                        Back to Home
                    </Link>
                </div>

                {/* Interactive Easter Egg */}
                <div
                    className="mt-16 sm:mt-24 h-8 flex items-center justify-center cursor-crosshair"
                    onMouseEnter={() => setEggDiscovered(true)}
                    onMouseLeave={() => setEggDiscovered(false)}
                >
                    <p className={`text-xs font-mono transition-all duration-300 ${eggDiscovered ? 'text-purple-600 scale-110 font-bold' : 'text-gray-400'}`}>
                        {eggDiscovered
                            ? "Okay, fine. Here's a cookie for your trouble: 🍪"
                            : "// Pro tip: clicking the screen harder won't make the page appear."}
                    </p>
                </div>

            </div>
        </div>
    );
};

export default NotFound;